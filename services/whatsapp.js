'use strict';

/**
 * services/whatsapp.js
 *
 * WhatsApp notification service.
 * Sends booking notifications to the manager and (optionally) the guest.
 *
 * CRITICAL: WhatsApp failures must NEVER block or roll back a booking.
 * All notifications are fire-and-forget with async error logging only.
 *
 * Supports two providers (configured via WHATSAPP_PROVIDER env var):
 *   - 'twilio'  : Twilio WhatsApp sandbox / Business API
 *   - 'wati'    : WATI (WhatsApp Team Inbox) API
 *   - 'console' : Development mode — prints to console, no HTTP calls
 *
 * If WHATSAPP_PROVIDER is not set or credentials are missing,
 * falls back to 'console' mode silently.
 */

const https = require('https');

// ── Provider detection ────────────────────────────────────────
const PROVIDER = (() => {
  const p = (process.env.WHATSAPP_PROVIDER || 'console').toLowerCase();
  if (p === 'twilio' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return 'twilio';
  }
  if (p === 'wati' && process.env.WATI_API_URL && process.env.WATI_API_TOKEN) {
    return 'wati';
  }
  return 'console';
})();

if (PROVIDER === 'console') {
  console.log('[WhatsApp] Running in CONSOLE mode — notifications will be printed, not sent.');
}

// ── Formatting helpers ────────────────────────────────────────

/**
 * Formats a booking into the manager notification message.
 * @param {Object} booking
 * @returns {string}
 */
function formatManagerMessage(booking) {
  const slotLabel = booking.slot === 'day' ? 'Day (8AM–8PM)' : 'Night (8PM–8AM)';
  return [
    '🏡 *New Booking Request — The Green Acre*',
    '',
    `📋 Ref: *${booking.id}*`,
    `👤 Guest: ${booking.guest_name}`,
    `📞 Phone: ${booking.guest_phone}`,
    booking.guest_email ? `📧 Email: ${booking.guest_email}` : null,
    `👥 Guests: ${booking.guest_count}`,
    `📅 Date: ${booking.booking_date}`,
    `🕐 Slot: ${slotLabel}`,
    `💰 Rate: ₹${booking.rate_applied} (${booking.rate_label})`,
    booking.occasion ? `🎉 Occasion: ${booking.occasion}` : null,
    booking.notes ? `📝 Notes: ${booking.notes}` : null,
    '',
    '⚡ Login to admin panel to confirm or release this booking.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Formats the guest confirmation message.
 * @param {Object} booking
 * @returns {string}
 */
function formatGuestMessage(booking) {
  const slotLabel = booking.slot === 'day' ? 'Day Slot (8AM–8PM)' : 'Night Slot (8PM–8AM)';
  return [
    '✅ *Booking Request Received — The Green Acre*',
    '',
    `Hi ${booking.guest_name}! Your booking request has been received.`,
    '',
    `📋 Reference: *${booking.id}*`,
    `📅 Date: ${booking.booking_date}`,
    `🕐 Slot: ${slotLabel}`,
    `💰 Amount: ₹${booking.rate_applied}`,
    '',
    'Your slot is on hold while we process your request. The manager will confirm once the advance payment is received.',
    '',
    '🔍 Track status: ' + (process.env.FRONTEND_URL || 'https://greenacre.vercel.app') + `/booking-status?ref=${booking.id}`,
  ].join('\n');
}

// ── Provider implementations ──────────────────────────────────

/**
 * Sends a message via Twilio WhatsApp API.
 * @param {string} to      - Phone number (E.164 format, e.g. +919876543210)
 * @param {string} message - Text content
 */
async function sendViaTwilio(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'; // Twilio sandbox

  const body = new URLSearchParams({
    From: `whatsapp:${from.replace('whatsapp:', '')}`,
    To: `whatsapp:${to}`,
    Body: message,
  }).toString();

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Twilio error ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Sends a message via WATI API.
 * @param {string} to      - Phone number without + (e.g. 919876543210)
 * @param {string} message - Text content
 */
async function sendViaWati(to, message) {
  const apiUrl = process.env.WATI_API_URL; // e.g. https://live-server-XXXXX.wati.io
  const token = process.env.WATI_API_TOKEN;
  const phone = to.replace(/^\+/, ''); // Remove leading + for WATI

  const payload = JSON.stringify({ message });
  const url = `${apiUrl}/api/v1/sendSessionMessage/${phone}`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`WATI error ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Console fallback — used in development.
 */
function sendViaConsole(to, message) {
  console.log('\n' + '─'.repeat(60));
  console.log(`[WhatsApp CONSOLE] TO: ${to}`);
  console.log('─'.repeat(60));
  console.log(message);
  console.log('─'.repeat(60) + '\n');
  return Promise.resolve({ status: 'console_logged' });
}

// ── Unified send function ─────────────────────────────────────

/**
 * Sends a WhatsApp message via the configured provider.
 * @param {string} to
 * @param {string} message
 * @returns {Promise<void>}
 */
async function sendMessage(to, message) {
  switch (PROVIDER) {
    case 'twilio':
      return sendViaTwilio(to, message);
    case 'wati':
      return sendViaWati(to, message);
    default:
      return sendViaConsole(to, message);
  }
}

// ── Public notification functions ─────────────────────────────

/**
 * Notifies the manager of a new booking request.
 * FIRE-AND-FORGET — never throws, never blocks the booking flow.
 *
 * @param {Object} booking - The newly created booking row
 */
function notifyManager(booking) {
  const managerPhone = process.env.MANAGER_WHATSAPP_NUMBER;
  if (!managerPhone) {
    console.warn('[WhatsApp] MANAGER_WHATSAPP_NUMBER not set — skipping manager notification.');
    return;
  }

  const message = formatManagerMessage(booking);

  // Fire and forget — intentionally not awaited
  sendMessage(managerPhone, message).catch((err) => {
    console.error('[WhatsApp] Manager notification failed:', err.message);
    // TODO: In production, write to a failed_notifications table for manual retry
  });
}

/**
 * Notifies the guest that their booking request was received.
 * FIRE-AND-FORGET — never throws, never blocks the booking flow.
 *
 * @param {Object} booking - The newly created booking row
 */
function notifyGuest(booking) {
  if (!booking.guest_phone) return;

  const message = formatGuestMessage(booking);

  sendMessage(booking.guest_phone, message).catch((err) => {
    console.error('[WhatsApp] Guest notification failed:', err.message);
  });
}

/**
 * Notifies the guest that their booking has been confirmed.
 * FIRE-AND-FORGET.
 *
 * @param {Object} booking - The confirmed booking row
 */
function notifyGuestConfirmed(booking) {
  if (!booking.guest_phone) return;

  const slotLabel = booking.slot === 'day' ? 'Day Slot (8AM–8PM)' : 'Night Slot (8PM–8AM)';
  const message = [
    '🎉 *Booking Confirmed — The Green Acre!*',
    '',
    `Hi ${booking.guest_name}! Your booking is confirmed.`,
    '',
    `📋 Ref: *${booking.id}*`,
    `📅 Date: ${booking.booking_date}`,
    `🕐 Slot: ${slotLabel}`,
    '',
    'We look forward to hosting you. See you soon! 🏡',
  ].join('\n');

  sendMessage(booking.guest_phone, message).catch((err) => {
    console.error('[WhatsApp] Guest confirmed notification failed:', err.message);
  });
}

module.exports = { notifyManager, notifyGuest, notifyGuestConfirmed };
