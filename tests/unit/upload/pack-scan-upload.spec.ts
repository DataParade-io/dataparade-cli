import {
  SCAN_UPLOAD_MAX_JSON_BYTES,
  packScanUploadRequests,
} from '../../../src/upload/pack-scan-upload';

describe('packScanUploadRequests', () => {
  it('keeps small files together and splits a file that does not fit', () => {
    const requests = packScanUploadRequests(
      [
        { relativePath: 'ocsf-discoveries/a.json', content: 'aa' },
        { relativePath: 'ocsf-discoveries/b.json', content: 'bb' },
        { relativePath: 'graphify-out/graph.json', content: 'x'.repeat(200) },
      ],
      200
    );

    expect(requests[0]).toEqual({
      files: [
        { relativePath: 'ocsf-discoveries/a.json', content: 'aa' },
        { relativePath: 'ocsf-discoveries/b.json', content: 'bb' },
      ],
    });
    const parts = requests.slice(1);
    expect(parts.length).toBeGreaterThan(1);
    const joined = parts
      .map((request) => ('part' in request ? request.part.content : ''))
      .join('');
    expect(joined).toBe('x'.repeat(200));
    for (const request of parts) {
      expect(Buffer.byteLength(JSON.stringify(request), 'utf8')).toBeLessThanOrEqual(
        200
      );
    }
  });

  it('keeps the default cap under 4 MB and under the 20 second budget', () => {
    expect(SCAN_UPLOAD_MAX_JSON_BYTES).toBe(700_000);
    expect(SCAN_UPLOAD_MAX_JSON_BYTES).toBeLessThanOrEqual(4_000_000);

    const requests = packScanUploadRequests([
      {
        relativePath: 'graphify-out/graph.json',
        content: 'x'.repeat(SCAN_UPLOAD_MAX_JSON_BYTES),
      },
    ]);

    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(
        Buffer.byteLength(JSON.stringify(request), 'utf8')
      ).toBeLessThanOrEqual(SCAN_UPLOAD_MAX_JSON_BYTES);
    }
  });
});
