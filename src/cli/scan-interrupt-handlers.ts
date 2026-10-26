export type CliScanQuotaCompletionStatus = 'none' | 'in_flight' | 'done';

export type CliScanInterruptSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

export const CLI_SCAN_INTERRUPT_EXIT_CODES: Record<
  CliScanInterruptSignal,
  number
> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

/** Cap how long Ctrl+C waits on a hung complete API before exiting. */
export const CLI_SCAN_INTERRUPT_COMPLETE_TIMEOUT_MS = 2_500;

export type CliScanInterruptProcess = {
  on(
    event: string,
    listener: (...args: unknown[]) => void
  ): CliScanInterruptProcess | unknown;
  off?(
    event: string,
    listener: (...args: unknown[]) => void
  ): CliScanInterruptProcess | unknown;
  removeListener?(
    event: string,
    listener: (...args: unknown[]) => void
  ): CliScanInterruptProcess | unknown;
};

export type InstallCliScanInterruptHandlersInput = {
  proc: CliScanInterruptProcess;
  exit: (code: number) => void;
  getState: () => {
    apiKey?: string;
    jobId?: string;
    completionStatus: CliScanQuotaCompletionStatus;
    /** Pending normal-path complete, awaited (bounded) instead of duplicated. */
    inFlight?: Promise<unknown>;
  };
  /** Claim the completion so the scan's own paths don't report it again. */
  setCompletionStatus: (status: CliScanQuotaCompletionStatus) => void;
  onAbortUi: () => void;
  reportFailed: (input: {
    apiKey: string;
    jobId: string;
    timeoutMs: number;
  }) => Promise<void>;
};

const SIGNALS: CliScanInterruptSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** Below this, a follow-up report can't realistically land before exit. */
const MIN_REPORT_WINDOW_MS = 250;

/** Resolve when `promise` settles or `ms` elapses, whichever comes first. */
async function settleWithin(
  promise: Promise<unknown>,
  ms: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Release the CLI scan lock on Ctrl+C / kill / hangup, then exit.
 * Returns uninstall(); safe to call more than once.
 */
export function installCliScanInterruptHandlers(
  input: InstallCliScanInterruptHandlersInput
): () => void {
  let handling = false;
  let uninstalled = false;

  const remove = (
    event: string,
    listener: (...args: unknown[]) => void
  ): void => {
    if (typeof input.proc.off === 'function') {
      input.proc.off(event, listener);
      return;
    }
    if (typeof input.proc.removeListener === 'function') {
      input.proc.removeListener(event, listener);
    }
  };

  const onSignal = (signal: CliScanInterruptSignal): void => {
    const code = CLI_SCAN_INTERRUPT_EXIT_CODES[signal];
    if (handling) {
      input.exit(code);
      return;
    }
    handling = true;

    void (async () => {
      const deadline = Date.now() + CLI_SCAN_INTERRUPT_COMPLETE_TIMEOUT_MS;
      try {
        input.onAbortUi();
        const pending = input.getState();
        if (pending.completionStatus === 'in_flight' && pending.inFlight) {
          // Let the scan's own complete land; exiting now could cut it off.
          await settleWithin(pending.inFlight, deadline - Date.now());
        }

        // Re-read: a failed in-flight complete resets the status to 'none'.
        const state = input.getState();
        const remainingMs = deadline - Date.now();
        if (
          state.apiKey &&
          state.jobId &&
          state.completionStatus === 'none' &&
          remainingMs >= MIN_REPORT_WINDOW_MS
        ) {
          input.setCompletionStatus('in_flight');
          try {
            await input.reportFailed({
              apiKey: state.apiKey,
              jobId: state.jobId,
              timeoutMs: remainingMs,
            });
          } catch {
            // Lock release must not block exit.
          }
          // Exiting either way; keep the scan's finally from reporting again.
          input.setCompletionStatus('done');
        }
      } finally {
        input.exit(code);
      }
    })();
  };

  const listeners: Array<{
    signal: CliScanInterruptSignal;
    listener: (...args: unknown[]) => void;
  }> = SIGNALS.map((signal) => {
    const listener = (): void => {
      onSignal(signal);
    };
    input.proc.on(signal, listener);
    return { signal, listener };
  });

  return () => {
    if (uninstalled) return;
    uninstalled = true;
    for (const { signal, listener } of listeners) {
      remove(signal, listener);
    }
  };
}
