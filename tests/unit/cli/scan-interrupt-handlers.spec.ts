import { EventEmitter } from 'node:events';
import {
  CLI_SCAN_INTERRUPT_COMPLETE_TIMEOUT_MS,
  CLI_SCAN_INTERRUPT_EXIT_CODES,
  installCliScanInterruptHandlers,
  type CliScanQuotaCompletionStatus,
} from '../../../src/cli/scan-interrupt-handlers';

describe('installCliScanInterruptHandlers', () => {
  function setup(options?: {
    completionStatus?: CliScanQuotaCompletionStatus;
    inFlight?: Promise<unknown>;
    apiKey?: string;
    jobId?: string;
  }) {
    const proc = new EventEmitter();
    const exits: number[] = [];
    const abortUi = jest.fn();
    const reportFailed = jest.fn().mockResolvedValue(undefined);
    let completionStatus: CliScanQuotaCompletionStatus =
      options?.completionStatus ?? 'none';

    const uninstall = installCliScanInterruptHandlers({
      proc,
      exit: (code) => {
        exits.push(code);
      },
      getState: () => ({
        apiKey: options?.apiKey ?? 'dp_live_test',
        jobId: options?.jobId ?? 'job-1',
        completionStatus,
        inFlight: options?.inFlight,
      }),
      setCompletionStatus: (status) => {
        completionStatus = status;
      },
      onAbortUi: abortUi,
      reportFailed,
    });

    return {
      proc,
      exits,
      abortUi,
      reportFailed,
      uninstall,
      setCompletionStatus: (status: CliScanQuotaCompletionStatus) => {
        completionStatus = status;
      },
      getCompletionStatus: () => completionStatus,
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports scan_interrupted once on SIGINT and exits 130', async () => {
    const { proc, exits, abortUi, reportFailed, uninstall } = setup();

    proc.emit('SIGINT');
    await Promise.resolve();
    await Promise.resolve();

    expect(abortUi).toHaveBeenCalledTimes(1);
    expect(reportFailed).toHaveBeenCalledTimes(1);
    const [reportInput] = reportFailed.mock.calls[0] as [
      { apiKey: string; jobId: string; timeoutMs: number },
    ];
    expect(reportInput.apiKey).toBe('dp_live_test');
    expect(reportInput.jobId).toBe('job-1');
    expect(reportInput.timeoutMs).toBeGreaterThan(0);
    expect(reportInput.timeoutMs).toBeLessThanOrEqual(
      CLI_SCAN_INTERRUPT_COMPLETE_TIMEOUT_MS
    );
    expect(exits).toEqual([CLI_SCAN_INTERRUPT_EXIT_CODES.SIGINT]);

    uninstall();
  });

  it('exits immediately on a second signal without reporting again', async () => {
    const { proc, exits, reportFailed, uninstall } = setup();
    let resolveReport: (() => void) | undefined;
    reportFailed.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReport = resolve;
        })
    );

    proc.emit('SIGINT');
    await Promise.resolve();
    expect(reportFailed).toHaveBeenCalledTimes(1);

    proc.emit('SIGINT');
    expect(exits).toEqual([CLI_SCAN_INTERRUPT_EXIT_CODES.SIGINT]);
    expect(reportFailed).toHaveBeenCalledTimes(1);

    resolveReport?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(exits).toEqual([
      CLI_SCAN_INTERRUPT_EXIT_CODES.SIGINT,
      CLI_SCAN_INTERRUPT_EXIT_CODES.SIGINT,
    ]);

    uninstall();
  });

  it('waits for an in-flight complete instead of reporting again', async () => {
    let resolveInFlight: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      resolveInFlight = resolve;
    });
    const { proc, exits, reportFailed, uninstall, setCompletionStatus } = setup(
      { completionStatus: 'in_flight', inFlight }
    );

    proc.emit('SIGTERM');
    await Promise.resolve();
    expect(exits).toEqual([]);

    // The scan's own complete lands.
    setCompletionStatus('done');
    resolveInFlight?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(reportFailed).not.toHaveBeenCalled();
    expect(exits).toEqual([CLI_SCAN_INTERRUPT_EXIT_CODES.SIGTERM]);

    uninstall();
  });

  it('reports scan_interrupted when the in-flight complete fails', async () => {
    let rejectInFlight: ((err: Error) => void) | undefined;
    const inFlight = new Promise<void>((_resolve, reject) => {
      rejectInFlight = reject;
    });
    const { proc, exits, reportFailed, uninstall, setCompletionStatus } = setup(
      { completionStatus: 'in_flight', inFlight }
    );

    proc.emit('SIGINT');
    await Promise.resolve();

    // The scan path resets the status when its complete throws.
    setCompletionStatus('none');
    rejectInFlight?.(new Error('network down'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(reportFailed).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([CLI_SCAN_INTERRUPT_EXIT_CODES.SIGINT]);

    uninstall();
  });

  it('claims the completion so the scan path does not report again', async () => {
    const { proc, reportFailed, uninstall, getCompletionStatus } = setup();
    let statusDuringReport: CliScanQuotaCompletionStatus | undefined;
    reportFailed.mockImplementation(() => {
      statusDuringReport = getCompletionStatus();
      return Promise.resolve();
    });

    proc.emit('SIGINT');
    await new Promise((resolve) => setImmediate(resolve));

    expect(statusDuringReport).toBe('in_flight');
    expect(getCompletionStatus()).toBe('done');

    uninstall();
  });

  it('does not block exit when the complete API hangs past the timeout', async () => {
    jest.useFakeTimers();
    const { proc, exits, reportFailed, uninstall } = setup();
    reportFailed.mockImplementation(
      ({ timeoutMs }: { timeoutMs: number }) =>
        new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('aborted'));
          }, timeoutMs);
        })
    );

    proc.emit('SIGHUP');
    await Promise.resolve();

    expect(reportFailed).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([]);

    await jest.advanceTimersByTimeAsync(CLI_SCAN_INTERRUPT_COMPLETE_TIMEOUT_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(exits).toEqual([CLI_SCAN_INTERRUPT_EXIT_CODES.SIGHUP]);

    uninstall();
  });

  it('uses exit codes 130, 143, and 129 for SIGINT, SIGTERM, and SIGHUP', async () => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const { proc, exits, uninstall } = setup();
      proc.emit(signal);
      await Promise.resolve();
      await Promise.resolve();
      expect(exits).toEqual([CLI_SCAN_INTERRUPT_EXIT_CODES[signal]]);
      uninstall();
    }
  });
});
