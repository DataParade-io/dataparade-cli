import type { AiProposal } from "../types";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./types";
import {
  isLambdaInitializingError,
  LAMBDA_INIT_RETRY_DELAYS_MS,
  toUserFacingLambdaInitError,
} from "../lambda-init-error";

export type PlatformProxyProviderConfig = {
  apiBaseUrl: string;
  workspaceApiKey: string;
  jobId: string;
  /** Poll interval for async infer tasks (ms). */
  pollIntervalMs?: number;
  /** Max wait for a single infer task (ms). Default from SCAN_AI_HTTP_TIMEOUT_MS or 180000. */
  pollTimeoutMs?: number;
  /** Backoff delays when a task fails because the helper Lambda is still INIT. */
  lambdaInitRetryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

type InferTaskStatus = "pending" | "running" | "completed" | "failed";

type InferTaskResponse = {
  taskId: string;
  clientTaskId?: string | null;
  status: InferTaskStatus;
  proposals?: unknown[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  errorMessage?: string | null;
};

function resolvePollTimeoutMs(configured?: number): number {
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  const fromEnv = Number(process.env.SCAN_AI_HTTP_TIMEOUT_MS ?? "");
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return 180_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlatformProxyProvider implements AiProvider {
  readonly id = "openai" as const;

  constructor(private readonly config: PlatformProxyProviderConfig) {}

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.workspaceApiKey}`,
      "Content-Type": "application/json",
    };
  }

  private apiBase(): string {
    return this.config.apiBaseUrl.replace(/\/$/, "");
  }

  private async readErrorMessage(res: Response): Promise<string> {
    let message = `Platform AI infer failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message)) message = body.message.join(", ");
    } catch {
      // ignore
    }
    return message;
  }

  private wait(ms: number): Promise<void> {
    return (this.config.sleep ?? sleep)(ms);
  }

  private throwPlatformError(res: Response, message: string): never {
    if (isLambdaInitializingError(message)) {
      throw new Error(message);
    }
    if (res.status >= 500) {
      const detail =
        message === `Platform AI infer failed (${res.status})`
          ? "Internal server error"
          : message;
      throw new Error(
        `Platform AI service error (${res.status}): ${detail}. If this persists, redeploy the API with the CLI bundle and verify SCAN_WORKER_LLM_API_KEY.`,
      );
    }
    throw new Error(message);
  }

  async infer(request: AiProviderRequest): Promise<AiProviderResult> {
    const delays = this.config.lambdaInitRetryDelaysMs ?? [
      ...LAMBDA_INIT_RETRY_DELAYS_MS,
    ];
    let lastErr: unknown;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        return await this.inferOnce(request);
      } catch (err) {
        lastErr = err;
        if (attempt >= delays.length || !isLambdaInitializingError(err)) {
          throw toUserFacingLambdaInitError(err);
        }
        await this.wait(delays[attempt] ?? 0);
      }
    }
    throw toUserFacingLambdaInitError(lastErr);
  }

  private async inferOnce(request: AiProviderRequest): Promise<AiProviderResult> {
    const submitRes = await fetch(`${this.apiBase()}/api/scans/cli/ai/infer/tasks`, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        jobId: this.config.jobId,
        tasks: [
          {
            prompt: request.prompt,
            maxTokens: request.maxTokens,
            temperature: request.temperature,
          },
        ],
      }),
    });

    if (!submitRes.ok) {
      const message = await this.readErrorMessage(submitRes);
      this.throwPlatformError(submitRes, message);
    }

    const submitBody = (await submitRes.json()) as {
      tasks?: InferTaskResponse[];
    };
    const task = submitBody.tasks?.[0];
    if (!task?.taskId) {
      throw new Error("Platform AI infer submit returned no task id");
    }

    const pollIntervalMs = Math.max(
      500,
      Math.floor(this.config.pollIntervalMs ?? 1500),
    );
    const deadline = Date.now() + resolvePollTimeoutMs(this.config.pollTimeoutMs);

    while (Date.now() < deadline) {
      const pollRes = await fetch(
        `${this.apiBase()}/api/scans/cli/ai/infer/tasks?jobId=${encodeURIComponent(this.config.jobId)}&taskIds=${encodeURIComponent(task.taskId)}`,
        {
          method: "GET",
          headers: this.authHeaders(),
        },
      );

      if (!pollRes.ok) {
        const message = await this.readErrorMessage(pollRes);
        this.throwPlatformError(pollRes, message);
      }

      const pollBody = (await pollRes.json()) as {
        tasks?: InferTaskResponse[];
      };
      const current = pollBody.tasks?.[0];
      if (!current) {
        throw new Error("Platform AI infer poll returned no task");
      }

      if (current.status === "completed") {
        const proposals = (
          Array.isArray(current.proposals) ? current.proposals : []
        ) as AiProposal[];
        const usage = current.usage;
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

      if (current.status === "failed") {
        throw new Error(
          current.errorMessage?.trim() ||
            "Platform AI infer task failed without details",
        );
      }

      await this.wait(pollIntervalMs);
    }

    throw new Error(
      `Platform AI infer task timed out after ${resolvePollTimeoutMs(this.config.pollTimeoutMs)}ms (taskId=${task.taskId})`,
    );
  }
}
