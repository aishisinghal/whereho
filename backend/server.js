const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { sendSms } = require('./msg91');
const { createTransport } = require('./email');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Mount directions/routes handler
const directionsRouter = require('./routes/directions');
app.use('/api', directionsRouter);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// In-memory stores for prototype only
const liveLocations = {}; // journeyId -> { lat, lng, updatedAt }
const tokens = new Map(); // token -> { journeyId, userName, expiresAt }
const trustedContacts = new Map(); // userId -> [{ name, phone, email }]
const journeys = new Map(); // journeyId -> { userId, route, origin, destination, startedAt, eta }

// Simple health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Example: add trusted contact (prototype)
app.post('/api/trusted-contacts', (req, res) => {
  const { userId, contact } = req.body; // in prod, use auth
  if (!trustedContacts.has(userId)) trustedContacts.set(userId, []);
  trustedContacts.get(userId).push(contact);
  res.json({ ok: true });
});

io.on('connection', (socket) => {
  socket.on('joinJourney', ({ journeyId }) => {
    socket.join(`journey:${journeyId}`);
  });

  socket.on('location', ({ journeyId, lat, lng }) => {
    liveLocations[journeyId] = { lat, lng, updatedAt: Date.now() };
    io.to(`journey:${journeyId}`).emit('locationUpdate', { lat, lng, timestamp: Date.now() });
  });
});

function createLiveToken({ journeyId, userName, ttlSeconds = 3600 }) {
  const token = uuidv4().replace(/-/g, '').slice(0, 20);
  tokens.set(token, { journeyId, userName, expiresAt: Date.now() + ttlSeconds * 1000 });
  return token;
}

function getTokenPayload(token) {
  const p = tokens.get(token);
  if (!p) return null;
  if (p.expiresAt < Date.now()) { tokens.delete(token); return null; }
  return p;
}

// Live link page (simple JSON for prototype)
app.get('/live/:token', (req, res) => {
  const token = req.params.token;
  const payload = getTokenPayload(token);
  if (!payload) return res.status(404).send('Link expired or invalid');
  const loc = liveLocations[payload.journeyId];
  return res.json({ journeyId: payload.journeyId, userName: payload.userName, location: loc || null });
});

// SOS endpoint: create live token and send SMS via MSG91
app.post('/api/sos', async (req, res) => {
  try {
    const { userId = 'demo_user', userName = 'Demo User', journeyId } = req.body; // in prod, get from auth
    const loc = journeyId ? liveLocations[journeyId] : null;
    const token = createLiveToken({ journeyId: journeyId || `journey-${Date.now()}`, userName });
    const liveUrl = `${process.env.APP_URL || 'http://localhost:4000'}/live/${token}`;
    const gmap = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : 'Location unavailable';
    const message = `${userName} is in emergency. Live: ${liveUrl} (Google Maps: ${gmap})`;

    const contacts = trustedContacts.get(userId) || [];
    const sendResults = [];
    for (const c of contacts) {
      if (c.phone) {
        const r = await sendSms(c.phone, message);
        sendResults.push({ to: c.phone, result: r });
      }
    }

    // optionally trigger email via Gmail here
    res.json({ ok: true, dial: 'tel:100', sent: sendResults });
  } catch (err) {
    console.error('sos error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Start journey endpoint: create journeyId, store, and notify trusted contacts
app.post('/api/journeys/start', async (req, res) => {
  try {
    const { userId = 'demo_user', userName = 'Demo User', route, origin, destination } = req.body;
    if (!route) return res.status(400).json({ error: 'route required' });
    const journeyId = `journey-${uuidv4().slice(0,8)}`;
    const startedAt = Date.now();
    const eta = route.duration ? new Date(startedAt + route.duration * 1000).toISOString() : null;

    journeys.set(journeyId, { userId, userName, route, origin, destination, startedAt, eta });

    // Notify trusted contacts
    const contacts = trustedContacts.get(userId) || [];
    const startMsg = `${userName} has started the journey from ${origin && origin.lat ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : origin || 'unknown'} to ${destination && destination.lat ? `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}` : destination || 'unknown'} and will reach by ${eta || 'unknown'}`;
    const sendResults = [];
    for (const c of contacts) {
      if (c.phone) {
        const r = await sendSms(c.phone, startMsg);
        sendResults.push({ to: c.phone, result: r });
      }
    }

    res.json({ ok: true, journeyId, sent: sendResults });
  } catch (err) {
    console.error('start journey error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Expose some internals for route handlers (for prototype only)
app.set('liveLocations', liveLocations);
app.set('trustedContacts', trustedContacts);
app.set('createLiveToken', createLiveToken);
app.set('sendSms', sendSms);
app.set('journeys', journeys);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend running on ${PORT}`));
