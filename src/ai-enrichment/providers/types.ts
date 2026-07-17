import type { AiProposal, AiProviderId } from "../types";

export interface AiProviderRequest {
  prompt: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Overrides the bundled enrichment system prompt (DP-P0-CLI-3813).
   * Set by the DataParade backend on the Platform AI path so the server owns
   * the system role. Unset for BYOK, which keeps the CLI-bundled prompt.
   */
  systemPrompt?: string;
}

export interface AiProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Best-effort estimate; only present when pricing info is known. */
  estimatedCostUsd?: number;
}

export interface AiProviderResult {
  proposals: AiProposal[];
  usage?: AiProviderUsage;
}

export interface AiProvider {
  id: AiProviderId;
  infer(request: AiProviderRequest): Promise<AiProviderResult>;
}

