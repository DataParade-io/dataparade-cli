import fs from 'fs';
import os from 'os';
import path from 'path';
import { run } from '../../../src/cli';

function jsonResponse(
  body: unknown,
  status = 200
): {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  };
}

const IP_CAP_MESSAGE =
  'Too many anonymous CLI scans from this IP (max 3). Create an account or use a workspace API key.';

describe('scan keeps going when AI enrichment or upload is unavailable', () => {
  let tempRoot: string;
  let projectDir: string;
  let outputPath: string;
  let fetchMock: jest.Mock;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  const printed = (): string =>
    [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.map((call) => call.join(' ')))
      .join('\n');

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-scan-fallback-'));
    projectDir = path.join(tempRoot, 'project');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(
      path.join(projectDir, 'index.ts'),
      "export const handler = () => fetch('https://api.stripe.com/v1/charges');\n"
    );
    outputPath = path.join(tempRoot, 'out', 'dataflow.json');
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.DATAPARADE_WORKSPACE_API_KEY;
    delete process.env.SCAN_HOSTED_INFER_PROXY_URL;
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.DATAPARADE_SKIP_AUTO_UPLOAD;
    process.exitCode = 0;
  });

  it('runs a structural scan when the anonymous AI session cannot reach the API', async () => {
    process.env.DATAPARADE_SKIP_AUTO_UPLOAD = 'true';
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
      })
    );

    await run([
      'node',
      'cli',
      'scan',
      projectDir,
      '--ai-inference',
      '--output',
      outputPath,
    ]);

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/scans/cli/ai/anonymous-session'
    );
    expect(process.exitCode ?? 0).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.existsSync(path.join(tempRoot, 'out', 'facts.json'))).toBe(true);
    const output = printed();
    expect(output).toContain(
      'AI enrichment unavailable (could not reach the DataParade API: ECONNREFUSED: connect ECONNREFUSED); continuing with a structural scan. Use --no-ai-inference to skip this step.'
    );
    expect(output).not.toContain('Scan failed');
  });

  it('runs a structural scan when the anonymous per-IP cap is reached', async () => {
    process.env.DATAPARADE_SKIP_AUTO_UPLOAD = 'true';
    fetchMock.mockResolvedValue(
      jsonResponse({ statusCode: 429, message: IP_CAP_MESSAGE }, 429)
    );

    await run([
      'node',
      'cli',
      'scan',
      projectDir,
      '--ai-inference',
      '--output',
      outputPath,
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode ?? 0).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(printed()).toContain(
      `AI enrichment unavailable (${IP_CAP_MESSAGE.replace(/\.$/, '')}); continuing with a structural scan.`
    );
  });

  it('runs a structural scan when the workspace preflight cannot reach the API', async () => {
    process.env.DATAPARADE_WORKSPACE_API_KEY = 'dp_live_test';
    process.env.DATAPARADE_SKIP_AUTO_UPLOAD = 'true';
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await run([
      'node',
      'cli',
      'scan',
      projectDir,
      '--ai-inference',
      '--output',
      outputPath,
    ]);

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/api/scans/cli/preflight'
    );
    expect(process.exitCode ?? 0).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(printed()).toContain('AI enrichment unavailable (');
  });

  it('says the upload did not complete and how to retry when it is refused', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/scans/cli/preview')) {
        return jsonResponse({ statusCode: 429, message: IP_CAP_MESSAGE }, 429);
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    });

    await run([
      'node',
      'cli',
      'scan',
      projectDir,
      '--no-ai-inference',
      '--output',
      outputPath,
    ]);

    expect(process.exitCode ?? 0).toBe(0);
    expect(fs.existsSync(outputPath)).toBe(true);
    const output = printed();
    expect(output).toContain(`[scan] Auto-upload failed: ${IP_CAP_MESSAGE}`);
    expect(output).toContain('The upload did not complete:');
    const relative = path.relative(process.cwd(), outputPath);
    const expectedTarget = relative.startsWith('..') ? outputPath : relative;
    expect(output).toContain(`dataparade upload ${expectedTarget}`);
    expect(output).toContain('DATAPARADE_WORKSPACE_API_KEY');
    expect(output).toContain('Scan finished. The upload did not complete.');
    expect(output).not.toContain('All done — nice work.');
  });

  it('gives the retry command without the API key hint on a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await run([
      'node',
      'cli',
      'scan',
      projectDir,
      '--no-ai-inference',
      '--output',
      outputPath,
    ]);

    expect(process.exitCode ?? 0).toBe(0);
    const output = printed();
    expect(output).toContain(
      'The upload did not complete: could not reach the DataParade API'
    );
    expect(output).toContain('dataparade upload ');
    expect(output).not.toContain('DATAPARADE_WORKSPACE_API_KEY');
    expect(output).not.toContain('All done — nice work.');
  });
});
