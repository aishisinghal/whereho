const nodemailer = require('nodemailer');

function createTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.warn('[email] Gmail credentials not set — email sending disabled');
    return null;
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
}

async function sendVerificationEmail(to, code) {
  const transporter = createTransport();
  if (!transporter) return { ok: false };
  const info = await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: 'Whereहो verification code',
    text: `Your verification code is ${code}`
  });
  return { ok: true, info };
}

module.exports = { createTransport, sendVerificationEmail };
