/**
 * Log redaction (security.md section 6, AR-20).
 *
 * Structured logs must never carry credentials. `redact()` deep-clones a
 * value, replacing the value of any key that denotes a secret with
 * `[REDACTED]`. It is applied to every log `meta` object by `JsonLogger`.
 *
 * Matching is intentionally biased toward over-redaction: a redacted
 * non-secret is harmless, a leaked secret is an incident.
 */

export const REDACTED = '[REDACTED]';
const TRUNCATED = '[Truncated]';
const MAX_DEPTH = 8;

const SENSITIVE_WORDS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'secrets',
  'token',
  'tokens',
  'credential',
  'credentials',
  'cookie',
  'cookies',
  'authorization',
  'auth',
  'apikey',
  'apisecret',
  'privatekey',
  'jwt',
  'bearer',
  'sessionkey',
  'otp',
  'totp',
]);

const SENSITIVE_COMPOUNDS = [
  'databaseurl',
  'connectionstring',
  'privatekey',
  'sessionkey',
  'apikey',
  'accesskey',
];

function tokenize(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

/** True when the key denotes a secret whose value must not be logged. */
export function isSensitiveKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SENSITIVE_COMPOUNDS.some((compound) => compact.includes(compound)))
    return true;
  return tokenize(key).some((word) => SENSITIVE_WORDS.has(word));
}

/**
 * Deep-clone `value`, redacting secrets. Safe for cycles, Errors, Buffers,
 * Maps/Sets, bigints, and values nested deeper than MAX_DEPTH.
 */
export function redact(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean')
    return value;
  if (type === 'bigint') return String(value);
  if (type === 'function' || type === 'symbol') return `[${type}]`;

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return '[Circular]';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj)) return '[Buffer]';
  if (obj instanceof Date) return obj;
  if (obj instanceof Map) return '[Map]';
  if (obj instanceof Set) return '[Set]';
  if (obj instanceof Error) {
    const out: Record<string, unknown> = {
      name: obj.name,
      message: obj.message,
    };
    if (obj.stack !== undefined) out['stack'] = obj.stack;
    return out;
  }

  seen.add(obj);
  if (Array.isArray(obj))
    return obj.map((item) => redact(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(obj)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(entry, depth + 1, seen);
  }
  return out;
}
