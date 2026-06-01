import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";

export class MockAiProvider implements AiProvider {
  id = "mock" as const;

  async infer(_request: AiProviderRequest): Promise<AiProviderResult> {
    return { proposals: [] };
  }
}

