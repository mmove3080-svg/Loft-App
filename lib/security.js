'use strict';
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function settings(env = process.env) {
  const url = env.SUPABASE_URL;
  if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url) || !env.SUPABASE_PUBLISHABLE_KEY || !env.APP_OWNER_USER_ID) {
    throw new HttpError(503, 'Cloud login is not configured. Check the Vercel environment variables.');
  }
  return { url: url.replace(/\/$/, ''), key: env.SUPABASE_PUBLISHABLE_KEY, owner: env.APP_OWNER_USER_ID };
}
async function owner(req, config, fetcher = fetch) {
  const header = req.headers.authorization || '';
  if (!/^Bearer [^\s]+$/.test(header)) throw new HttpError(401, 'Please sign in.');
  let response;
  try {
    response = await fetcher(config.url + '/auth/v1/user', {
      headers: {apikey: config.key, Authorization: header}, signal: AbortSignal.timeout(15000), cache: 'no-store'
    });
  } catch { throw new HttpError(503, 'Login verification is temporarily unavailable. Try again.'); }
  if (!response.ok) throw new HttpError(response.status >= 500 ? 503 : 401, 'Please sign in again.');
  const user = await response.json();
  if (user.id !== config.owner) throw new HttpError(403, 'This app is restricted to its owner.');
  return user.id;
}
function snapshotId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new HttpError(400, 'Invalid snapshot ID.');
  return value;
}
function partId(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,5})$/.test(value)) throw new HttpError(400, 'Invalid part number.');
  return value;
}
module.exports = {HttpError, settings, owner, snapshotId, partId};
