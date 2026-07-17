import { getDataparadeApiBaseUrl } from "./dataparade-api-base-url";

export type AnonymousAiSessionResponse = {
  sessionToken: string;
  jobId: string;
  suggestedAiBudgetTokens: number;
  expiresAt: string;
  aiDelivery: "platform_proxy" | "none";
};

export class CliAnonymousIpLimitError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "CliAnonymousIpLimitError";
  }
}

export async function cliAnonymousAiSession(input?: {
  projectName?: string;
}): Promise<AnonymousAiSessionResponse> {
  const res = await fetch(
    `${getDataparadeApiBaseUrl()}/api/scans/cli/ai/anonymous-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectName: input?.projectName,
      }),
    },
  );

  if (!res.ok) {
    let message = `Anonymous AI session failed (${res.status})`;
    try {
      const body = (await res.json()) as {
        message?: string | string[];
      };
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
    } catch {
      // ignore
    }
    if (res.status === 429) {
      throw new CliAnonymousIpLimitError(message);
    }
    throw new Error(message);
  }

  return (await res.json()) as AnonymousAiSessionResponse;
}
