/**
 * Providers sometimes wrap JSON in fences or append stray text.
 * These helpers recover a single top-level `{ ... }` object when possible.
 */

export function stripJsonFences(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence?.[1]) return fence[1].trim();
  return t;
}

/**
 * First complete `{ ... }` from `start`, respecting string escapes and nesting.
 * Returns null if braces never balance (e.g. truncated response).
 */
export function extractBalancedJsonObject(s: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

function firstObjectBraceIndex(s: string): number {
  return s.indexOf("{");
}

export function jsonParseErrorPosition(err: unknown): number | null {
  const m = String(err).match(/position (\d+)/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse model text as JSON: strict parse first, then balanced slice from first `{`.
 */
export function parseProviderJsonContent(content: string): {
  ok: true;
  value: unknown;
} | {
  ok: false;
  error: unknown;
  /** Snippet around JSON.parse error index when available */
  contextSnippet?: string;
} {
  const cleaned = stripJsonFences(content.trim()).replace(/^\uFEFF/, "");

  const tryParse = (raw: string) => {
    try {
      return { ok: true as const, value: JSON.parse(raw) };
    } catch (err) {
      return { ok: false as const, err };
    }
  };

  const first = tryParse(cleaned);
  if (first.ok) return first;

  const braceAt = firstObjectBraceIndex(cleaned);
  if (braceAt >= 0) {
    const slice = extractBalancedJsonObject(cleaned, braceAt);
    if (slice != null && slice !== cleaned) {
      const second = tryParse(slice);
      if (second.ok) return second;
    }
  }

  const pos = jsonParseErrorPosition(first.err);
  const contextSnippet =
    pos != null && cleaned.length > 0
      ? cleaned.slice(Math.max(0, pos - 120), Math.min(cleaned.length, pos + 120))
      : undefined;

  return { ok: false, error: first.err, contextSnippet };
}
