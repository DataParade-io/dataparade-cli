import { describeThrownError } from '../../../src/platform-api/fetch-failure';

describe('describeThrownError', () => {
  it('unwraps a bare fetch failure and includes the socket cause', () => {
    const err = new TypeError('fetch failed') as TypeError & {
      cause?: unknown;
    };
    err.cause = Object.assign(new Error('other side closed'), {
      code: 'ECONNRESET',
    });

    expect(describeThrownError(err)).toBe(
      'Could not reach the DataParade API: ECONNRESET: other side closed. Run the scan again.'
    );
  });

  it('keeps an error that already names the request', () => {
    const err = new Error(
      'Could not reach the DataParade API (POST http://localhost:3000/api/scans/cli/ai/infer/tasks): ECONNRESET: other side closed. Tried 3 times. Run the scan again.'
    );
    expect(describeThrownError(err)).toBe(err.message);
  });
});
