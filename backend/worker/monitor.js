// worker/monitor.js
// Background monitor: checks active journeys for missed check-ins and sustained route deviation.

require('dotenv').config();
const Redis = require('ioredis');
const { sendSms } = require('../msg91');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

function decodePolyline(str) {
  if (!str) return [];
  let index = 0, lat = 0, lng = 0, points = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function toRad(n) { return n * Math.PI / 180; }
function haversineDistance(a, b) {
  const R = 6371000; // meters
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat/2), sinDLon = Math.sin(dLon/2);
  const c = 2 * Math.asin(Math.sqrt(sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon));
  return R * c;
}

function pointToSegmentDistance(p, v, w) {
  // p, v, w are {lat,lng}
  // project p onto segment vw (in Euclidean approx using lat/lng converted to meters via simple equirectangular projection)
  // convert to meters using rough approximations
  const x = (lng) => toRad(lng) * 6371000 * Math.cos(toRad(p.lat));
}

function distancePointToPolyline(point, polyPoints) {
  // compute minimum distance from point to each segment
  if (!polyPoints || polyPoints.length === 0) return Infinity;
  let minD = Infinity;
  for (let i = 0; i < polyPoints.length - 1; i++) {
    const a = polyPoints[i];
    const b = polyPoints[i+1];
    const d = distancePointToSegment(point, a, b);
    if (d < minD) minD = d;
  }
  return minD;
}

function distancePointToSegment(p, v, w) {
  // using lat/lng with haversine projection approximation by converting to meter coordinates via Web Mercator-ish approach
  // For accuracy we project lat/lng to x/y using equirectangular projection centered at p.lat
  const R = 6371000;
  const toX = (lng) => toRad(lng) * R * Math.cos(toRad(p.lat));
  const toY = (lat) => toRad(lat) * R;
  const px = toX(p.lng), py = toY(p.lat);
  const vx = toX(v.lng), vy = toY(v.lat);
  const wx = toX(w.lng), wy = toY(w.lat);
  const dx = wx - vx, dy = wy - vy;
  const l2 = dx*dx + dy*dy;
  if (l2 === 0) return Math.hypot(px - vx, py - vy);
  let t = ((px - vx) * dx + (py - vy) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projx = vx + t*dx, projy = vy + t*dy;
  const dist = Math.hypot(px - projx, py - projy);
  return dist; // meters
}

async function checkJourneys() {
  try {
    const journeyIds = await redis.smembers('activeJourneys');
    const now = Date.now();
    for (const jid of journeyIds) {
      const meta = await redis.hgetall(`journey:${jid}`);
      if (!meta || Object.keys(meta).length === 0) {
        await redis.srem('activeJourneys', jid);
        continue;
      }
      const userId = meta.userId;
      const userName = meta.userName;
      const poly = meta.poly || '';
      const checkinInterval = parseInt(meta.checkinInterval || '600', 10);
      const missedCount = parseInt(meta.missedCount || '0', 10);
      const missedNotified = meta.missedNotified === '1';
      const deviationNotified = meta.deviationNotified === '1';
      const lastCheckin = parseInt(meta.lastCheckin || meta.startedAt || '0', 10);

      // missed check-ins
      const sinceLastCheck = now - (lastCheckin || 0);
      if (sinceLastCheck > (missedCount + 1) * checkinInterval * 1000) {
        const newMissed = missedCount + 1;
        await redis.hset(`journey:${jid}`, 'missedCount', String(newMissed));
        console.log(`journey ${jid} missed check-in #${newMissed}`);
        // if reached threshold (3) and not yet notified, notify contacts
        if (newMissed >= 3 && !missedNotified) {
          const contactsRaw = await redis.lrange(`trusted:${userId}`, 0, -1);
          const contacts = contactsRaw.map(r => JSON.parse(r));
          const msg = `${userName} has missed ${newMissed} check-ins for journey ${jid}. Last known location: ${await getLocationText(jid)}`;
          for (const c of contacts) {
            if (c.phone) await sendSms(c.phone, msg);
          }
          await redis.hset(`journey:${jid}`, 'missedNotified', '1');
        }
      }

      // route deviation check
      const locRaw = await redis.get(`journey:${jid}:lastLocation`);
      if (locRaw) {
        const loc = JSON.parse(locRaw);
        const point = { lat: loc.lat, lng: loc.lng };
        const polyPoints = decodePolyline(poly);
        const dist = distancePointToPolyline(point, polyPoints); // meters
        const threshold = 200; // meters
        const devStart = parseInt(meta.deviationStartAt || '0', 10);
        if (dist > threshold) {
          if (devStart === 0) {
            // mark start
            await redis.hset(`journey:${jid}`, 'deviationStartAt', String(now));
          } else {
            const elapsed = now - devStart;
            if (elapsed > 2 * 60 * 1000 && !deviationNotified) { // 2 minutes sustained
              const contactsRaw = await redis.lrange(`trusted:${userId}`, 0, -1);
              const contacts = contactsRaw.map(r => JSON.parse(r));
              const msg = `${userName} appears to have deviated from the planned route for journey ${jid}. Last known location: ${await getLocationText(jid)} (distance ${Math.round(dist)} m from route)`;
              for (const c of contacts) {
                if (c.phone) await sendSms(c.phone, msg);
              }
              await redis.hset(`journey:${jid}`, 'deviationNotified', '1');
            }
          }
        } else {
          // back on route: clear deviationStartAt and deviationNotified
          if (devStart !== 0 || deviationNotified) {
            await redis.hset(`journey:${jid}`, 'deviationStartAt', '0');
            await redis.hset(`journey:${jid}`, 'deviationNotified', '0');
          }
        }
      }
    }
  } catch (err) {
    console.error('monitor error', err);
  }
}

async function getLocationText(jid) {
  const locRaw = await redis.get(`journey:${jid}:lastLocation`);
  if (!locRaw) return 'unknown';
  const loc = JSON.parse(locRaw);
  return `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
}

console.log('Monitor started — checking active journeys every 30s');
setInterval(checkJourneys, 30 * 1000);

// run immediately
checkJourneys();
