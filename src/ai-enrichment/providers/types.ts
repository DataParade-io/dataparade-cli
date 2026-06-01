import type { AiProposal, AiProviderId } from "../types";

export interface AiProviderRequest {
  prompt: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
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

