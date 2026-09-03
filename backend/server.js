require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const { sendSms } = require('./msg91');
const { createTransport } = require('./email');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Mount directions/routes handler
const directionsRouter = require('./routes/directions');
app.use('/api', directionsRouter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// In-memory stores remain for quick access, but canonical state is in Redis for worker processes
const inMemory = {
  journeys: new Map(),
};

// Simple health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Example: add trusted contact (prototype)
app.post('/api/trusted-contacts', async (req, res) => {
  const { userId, contact } = req.body; // in prod, use auth
  if (!userId || !contact) return res.status(400).json({ error: 'userId and contact required' });
  const key = `trusted:${userId}`;
  await redis.rpush(key, JSON.stringify(contact));
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.on('joinJourney', ({ journeyId }) => {
    if (!journeyId) return;
    socket.join(`journey:${journeyId}`);
  });

  socket.on('location', async ({ journeyId, lat, lng }) => {
    if (!journeyId || typeof lat !== 'number' || typeof lng !== 'number') return;
    const now = Date.now();
    // store last location in Redis
    await redis.set(`journey:${journeyId}:lastLocation`, JSON.stringify({ lat, lng, updatedAt: now }));
    await redis.hset(`journey:${journeyId}`, 'lastSeenAt', String(now));
    // broadcast to room
    io.to(`journey:${journeyId}`).emit('locationUpdate', { lat, lng, timestamp: now });
  });
});

function createLiveToken({ journeyId, userName, ttlSeconds = 3600 }) {
  const token = uuidv4().replace(/-/g, '').slice(0, 20);
  const payload = { journeyId, userName, expiresAt: Date.now() + ttlSeconds * 1000 };
  // store payload as JSON
  redis.set(`token:${token}`, JSON.stringify(payload), 'EX', ttlSeconds);
  return token;
}

async function getTokenPayload(token) {
  const raw = await redis.get(`token:${token}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Live link page (JSON)
app.get('/live/:token', async (req, res) => {
  const token = req.params.token;
  const payload = await getTokenPayload(token);
  if (!payload) return res.status(404).send('Link expired or invalid');
  const locRaw = await redis.get(`journey:${payload.journeyId}:lastLocation`);
  const loc = locRaw ? JSON.parse(locRaw) : null;
  res.json({ journeyId: payload.journeyId, userName: payload.userName, location: loc || null });
});

// SOS endpoint: create live token and send SMS via MSG91
app.post('/api/sos', async (req, res) => {
  try {
    const { userId = 'demo_user', userName = 'Demo User', journeyId } = req.body; // in prod, get from auth
    const locRaw = journeyId ? await redis.get(`journey:${journeyId}:lastLocation`) : null;
    const loc = locRaw ? JSON.parse(locRaw) : null;
    const token = createLiveToken({ journeyId: journeyId || `journey-${Date.now()}`, userName });
    const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
    const liveUrlFrontend = `${frontendUrl.replace(/\/$/, '')}/live.html?token=${token}`;
    const gmap = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : 'Location unavailable';
    const message = `${userName} is in emergency. Live: ${liveUrlFrontend} (Google Maps: ${gmap})`;

    // get contacts from Redis list
    const contactsRaw = await redis.lrange(`trusted:${userId}`, 0, -1);
    const contacts = contactsRaw.map(r => JSON.parse(r));
    const sendResults = [];
    for (const c of contacts) {
      if (c.phone) {
        const r = await sendSms(c.phone, message);
        sendResults.push({ to: c.phone, result: r });
      }
    }

    res.json({ ok: true, dial: 'tel:100', sent: sendResults, liveLink: liveUrlFrontend });
  } catch (err) {
    console.error('sos error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Start journey endpoint: create journeyId, persist to Redis, and notify trusted contacts (with live link)
app.post('/api/journeys/start', async (req, res) => {
  try {
    const { userId = 'demo_user', userName = 'Demo User', route, origin, destination, checkinInterval = 600 } = req.body;
    if (!route) return res.status(400).json({ error: 'route required' });
    const journeyId = `journey-${uuidv4().slice(0,8)}`;
    const startedAt = Date.now();
    const eta = route.duration ? new Date(startedAt + route.duration * 1000).toISOString() : null;

    // store journey in Redis hash
    await redis.hset(`journey:${journeyId}`, {
      userId,
      userName,
      poly: route.poly || '',
      origin: JSON.stringify(origin || ''),
      destination: JSON.stringify(destination || ''),
      startedAt: String(startedAt),
      eta: eta || '',
      checkinInterval: String(checkinInterval),
      missedCount: '0',
      deviationNotified: '0',
      missedNotified: '0'
    });
    // add to active set
    await redis.sadd('activeJourneys', journeyId);

    // create live token and frontend link
    const token = createLiveToken({ journeyId, userName, ttlSeconds: 60*60 });
    const frontendUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';
    const liveUrlFrontend = `${frontendUrl.replace(/\/$/, '')}/live.html?token=${token}`;
    const startMsg = `${userName} has started the journey from ${origin && origin.lat ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : origin || 'unknown'} to ${destination && destination.lat ? `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}` : destination || 'unknown'} and will reach by ${eta || 'unknown'}. Live: ${liveUrlFrontend}`;

    // Notify trusted contacts
    const contactsRaw = await redis.lrange(`trusted:${userId}`, 0, -1);
    const contacts = contactsRaw.map(r => JSON.parse(r));
    const sendResults = [];
    for (const c of contacts) {
      if (c.phone) {
        const r = await sendSms(c.phone, startMsg);
        sendResults.push({ to: c.phone, result: r });
      }
    }

    // also keep an in-memory ref for quick lookup
    inMemory.journeys.set(journeyId, { userId, userName, route, origin, destination, startedAt, eta });

    res.json({ ok: true, journeyId, liveLink: liveUrlFrontend, sent: sendResults });
  } catch (err) {
    console.error('start journey error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Check-in endpoint: called by client when user responds to periodic "Are you okay?" prompt
app.post('/api/journeys/:id/checkin', async (req, res) => {
  try {
    const journeyId = req.params.id;
    const now = Date.now();
    const exists = await redis.exists(`journey:${journeyId}`);
    if (!exists) return res.status(404).json({ error: 'journey not found' });
    await redis.hset(`journey:${journeyId}`, 'lastCheckin', String(now));
    await redis.hset(`journey:${journeyId}`, 'missedCount', '0');
    // clear missedNotified flag so future misses can notify again
    await redis.hset(`journey:${journeyId}`, 'missedNotified', '0');
    res.json({ ok: true, timestamp: now });
  } catch (err) {
    console.error('checkin error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Expose some internals for diagnostics
app.get('/api/_debug/journeys', async (req, res) => {
  const keys = await redis.smembers('activeJourneys');
  const out = [];
  for (const j of keys) {
    const h = await redis.hgetall(`journey:${j}`);
    const locRaw = await redis.get(`journey:${j}:lastLocation`);
    out.push({ journeyId: j, meta: h, lastLocation: locRaw ? JSON.parse(locRaw) : null });
  }
  res.json(out);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend running on ${PORT}`));
