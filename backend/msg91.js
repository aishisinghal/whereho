const fetch = require('node-fetch');

// Minimal MSG91 helper using legacy sendhttp.php endpoint (change as needed for your MSG91 plan)
// NOTE: For production, use the official MSG91 V5 APIs and follow their docs for templates and transactional SMS.

const AUTH_KEY = process.env.MSG91_AUTH_KEY;
const SENDER = process.env.MSG91_SENDER || 'MSGIND';

async function sendSms(mobile, message) {
  if (!AUTH_KEY) {
    console.log('[msg91] AUTH_KEY not set — skipping SMS send. Would have sent to', mobile, message);
    return { ok: false, reason: 'no-auth-key' };
  }
  // Using the simple HTTP API (GET)
  const encoded = encodeURIComponent(message);
  const url = `https://api.msg91.com/api/sendhttp.php?authkey=${AUTH_KEY}&mobiles=${mobile}&message=${encoded}&sender=${SENDER}&route=4&country=91`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    return { ok: true, raw: text };
  } catch (err) {
    console.error('msg91 send error', err);
    return { ok: false, error: String(err) };
  }
}

module.exports = { sendSms };
