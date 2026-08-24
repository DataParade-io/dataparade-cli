import pkg from "../../package.json";
import { getDataparadeApiBaseUrl } from "./dataparade-api-base-url";
import type { ReportCliUsageEventInput } from "./telemetry.types";

const TELEMETRY_TIMEOUT_MS = 2000;

const FALSY = new Set(["0", "false", "no", "off"]);
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isCliTelemetryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const explicit =
    env.DATAPARADE_TELEMETRY?.trim().toLowerCase() ||
    env.SCAN_TELEMETRY_ENABLED?.trim().toLowerCase();
  if (explicit && FALSY.has(explicit)) return false;
  if (explicit && TRUTHY.has(explicit)) return true;
  if (env.NODE_ENV === "test") return false;
  return true;
}

/**
 * Fire-and-forget CLI usage telemetry. Never throws.
 */
export async function reportCliUsageEvent(
  input: ReportCliUsageEventInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isCliTelemetryEnabled(env)) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    await fetch(`${getDataparadeApiBaseUrl(env)}/api/scans/cli/telemetry`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        sessionId: input.sessionId,
        event: input.event,
        command: input.command,
        hasApiKey: Boolean(input.hasApiKey ?? apiKey),
        cliVersion: input.cliVersion ?? pkg.version,
        draftId: input.draftId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage
          ? input.errorMessage.slice(0, 500)
          : undefined,
        source: input.source ?? "cli",
      }),
    });
  } catch {
    // Telemetry must never change CLI behavior.
  } finally {
    clearTimeout(timer);
  }
}
