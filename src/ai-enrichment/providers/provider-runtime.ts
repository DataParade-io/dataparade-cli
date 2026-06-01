import { parseProviderJsonContent } from "./provider-json-parse";
import { aiDebugEnabled } from "./provider-contract";

const SECRET_BODY_RE =
  /(?:api[_-]?key|authorization|bearer|x-api-key|key=)[^\s]{8,}/gi;

function redactSecretSubstrings(text: string): string {
  return text.replace(SECRET_BODY_RE, (match) => {
    const eq = match.indexOf("=");
    if (eq >= 0) {
      return `${match.slice(0, eq + 1)}<redacted>`;
    }
    const space = match.indexOf(" ");
    if (space >= 0) {
      return `${match.slice(0, space + 1)}<redacted>`;
    }
    return "<redacted>";
  });
}

export async function readJsonOrWarn(
  response: Response,
  providerLabel: string,
): Promise<unknown | null> {
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    if (aiDebugEnabled()) {
      const safe = redactSecretSubstrings(errBody).slice(0, 1200);
      console.warn(
        `[dataparade-ai] ${providerLabel} HTTP ${response.status}: ${safe}`,
      );
    }
    return null;
  }

  return response.json();
}

export function parseJsonTextOrWarn(
  text: string,
  options: { providerLabel: string; finishReason?: string | null },
): unknown | null {
  const parsed = parseProviderJsonContent(text);
  if (!parsed.ok) {
    if (aiDebugEnabled()) {
      console.warn(
        `[dataparade-ai] ${options.providerLabel} failed to parse model JSON:`,
        parsed.error,
      );
      if (parsed.contextSnippet != null) {
        console.warn(
          `[dataparade-ai] JSON context (near error): ...${parsed.contextSnippet}...`,
        );
      }
      if (options.finishReason != null) {
        console.warn(`[dataparade-ai] finish_reason=${options.finishReason}`);
      }
    }
    return null;
  }
  return parsed.value;
}

export function joinAnthropicTextBlocks(
  content: Array<{ type?: string; text?: string }> | undefined,
): string {
  return (content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
}
