export function parsePreviewAddress(value, base) {
  const input = String(value ?? '').trim();
  if (!input) return null;
  try {
    const url = input.startsWith('/') && base ? new URL(input, base)
      : new URL(/^(https?:\/\/|[a-z][a-z\d+.-]*:\/\/)/i.test(input) ? input : `http://${input}`);
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A local development server owns one preview across its routes and loopback aliases. */
export function samePreview(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const first = new URL(a);
    const second = new URL(b);
    return LOOPBACK.has(first.hostname) && LOOPBACK.has(second.hostname)
      && first.protocol === second.protocol && first.port === second.port;
  } catch {
    return false;
  }
}
