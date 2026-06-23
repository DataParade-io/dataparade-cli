import type { AiProposal } from "../types";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";

/**
 * Sync infer via the scan worker's loopback proxy (VPC → scan-cli-ai-helper Lambda).
 */
export class HostedWorkerInferProvider implements AiProvider {
  readonly id = "openai" as const;

  constructor(private readonly inferUrl: string) {}

  async infer(request: AiProviderRequest): Promise<AiProviderResult> {
    const res = await fetch(this.inferUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: request.prompt,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      }),
    });

    let body: {
      proposals?: unknown[];
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      };
      error?: string;
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new Error(`Hosted scan AI infer failed (${res.status})`);
    }

    if (!res.ok) {
      throw new Error(
        body.error?.trim() ||
          `Hosted scan AI infer failed (${res.status})`,
      );
    }

    const proposals = (
      Array.isArray(body.proposals) ? body.proposals : []
    ) as AiProposal[];
    const usage = body.usage;
    return {
      proposals,
      usage:
        usage && typeof usage.totalTokens === "number"
          ? {
              inputTokens: Math.max(0, usage.inputTokens ?? 0),
              outputTokens: Math.max(0, usage.outputTokens ?? 0),
              totalTokens: Math.max(0, usage.totalTokens),
            }
          : undefined,
    };
  }
}
