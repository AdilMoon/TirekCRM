// Cookie security and CSRF policy must use the same configured public origin,
// never Host or X-Forwarded-Proto supplied by a caller.
export function webOrigin() {
  const value = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error('WEB_ORIGIN must be an HTTP(S) origin without a path or trailing slash');
  }
  return value;
}
export function secureSessionCookie() {
  return process.env.NODE_ENV === 'production' || new URL(webOrigin()).protocol === 'https:';
}
export function allowedWebOrigins() {
  const origin = webOrigin();
  const allowed = new Set([origin]);
  // The old HTTP alias is only valid when running the HTTP development profile.
  if (process.env.NODE_ENV !== 'production' && origin === 'http://localhost:3000') allowed.add('http://127.0.0.1:3000');
  return allowed;
}
