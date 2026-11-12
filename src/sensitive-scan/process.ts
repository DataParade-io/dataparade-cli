import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Scanner stderr may contain third-party diagnostics. Never forward it. */
export async function runLocalScanner(
  executable: string,
  args: string[],
  input?: AsyncIterable<string>
): Promise<{ code: number | null; output: string }> {
  const child = spawn(executable, args, {
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const output: Buffer[] = [];
  let size = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => child.kill(), 300_000);
  const completed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) child.kill();
    else output.push(chunk);
  });
  const sending =
    input && child.stdin
      ? pipeline(Readable.from(input), child.stdin, {
          signal: controller.signal,
        }).catch((error: NodeJS.ErrnoException) => {
          if (
            error.code !== 'EPIPE' &&
            error.code !== 'ABORT_ERR' &&
            error.code !== 'ERR_STREAM_PREMATURE_CLOSE'
          ) {
            child.kill();
            throw error;
          }
        })
      : Promise.resolve();
  try {
    const [code] = await Promise.all([completed, sending]);
    return { code, output: Buffer.concat(output).toString('utf8') };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
