const SENSITIVE_KEY = /^(?:password|passwd|pwd|token|accessToken|refreshToken|authToken|apiKey|api[_-]key|secret|clientSecret|authorization|cookie|privateKey|private[_-]key)$/i;
const ASSIGNMENT = /(\b(?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|api[_-]?key|secret|authorization)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\[REDACTED\]|[^\s,;)}\]]+)/gi;
const BEARER = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g;

function redactString(value: string): string {
  return value
    .replace(PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(BEARER, "$1[REDACTED]")
    .replace(ASSIGNMENT, "$1[REDACTED]")
    .replace(/\[REDACTED\]\]+/g, "[REDACTED]");
}

export function redactSensitiveValues(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveValues(item),
  ]));
}

export function redactSerializedJson(value: string): string {
  try {
    return JSON.stringify(redactSensitiveValues(JSON.parse(value)));
  } catch {
    return JSON.stringify(redactSensitiveValues(value));
  }
}
