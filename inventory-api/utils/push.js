/**
 * Send push notifications via Expo Push API.
 * Used when a task is created (e.g. sign-off required for Repair/Maintenance/Hire).
 */
const https = require('https');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification to one or more Expo push tokens.
 * @param {Array<{ to: string, title?: string, body?: string, data?: object }>} messages
 * @returns {Promise<{ success: boolean, results?: any }>}
 */
async function sendExpoPush(messages) {
  if (!messages || messages.length === 0) return { success: true };
  const payload = messages.map((m) => ({
    to: m.to,
    title: m.title || 'New Task',
    body: m.body || 'You have a new task requiring your attention.',
    data: m.data || {},
    sound: 'default',
    channelId: 'default',
  }));

  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      EXPO_PUSH_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            resolve({ success: res.statusCode >= 200 && res.statusCode < 300, results: parsed });
          } catch {
            resolve({ success: false });
          }
        });
      }
    );
    req.on('error', () => resolve({ success: false }));
    req.write(body);
    req.end();
  });
}

module.exports = { sendExpoPush };
