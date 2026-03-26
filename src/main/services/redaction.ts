const REDACTION_TOKEN = "****";

export function redactSensitiveText(value?: string): string | undefined {
  if (!value) {
    return value;
  }

  return value
    .replace(/("apiKey"\s*:\s*")([^"]+)(")/gi, `$1${REDACTION_TOKEN}$3`)
    .replace(/(\bX-CAP-API-KEY\b\s*[:=]\s*)([^\s,;]+)/gi, `$1${REDACTION_TOKEN}`)
    .replace(/(\bapi[\s_-]*key\b\s*[:=]\s*)([^\s,;]+)/gi, `$1${REDACTION_TOKEN}`)
    .replace(/\bCAP-[A-Za-z0-9_-]{4,}\b/g, `CAP-${REDACTION_TOKEN}`);
}
