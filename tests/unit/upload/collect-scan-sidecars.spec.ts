import fs from 'fs';
import os from 'os';
import path from 'path';

import { collectScanUploadFiles } from '../../../src/upload/collect-scan-sidecars';
import {
  packScanUploadRequests,
  SCAN_UPLOAD_MAX_JSON_BYTES,
} from '../../../src/upload/pack-scan-upload';

describe('collectScanUploadFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-upload-files-'));
    fs.writeFileSync(path.join(dir, 'dataflow.json'), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends facts.json, the data item files, graphify.json and answers.json, in that order', () => {
    fs.writeFileSync(path.join(dir, 'facts.json'), '{"schemaVersion":1}');
    fs.mkdirSync(path.join(dir, 'data-items'));
    fs.writeFileSync(path.join(dir, 'data-items', 'phone.json'), '{"id":"data_item:phone"}');
    fs.writeFileSync(path.join(dir, 'data-items', 'email.json'), '{"id":"data_item:email"}');
    fs.writeFileSync(path.join(dir, 'graphify.json'), '{"nodes":[]}');
    fs.writeFileSync(path.join(dir, 'answers.json'), '{"schemaVersion":1,"answers":[]}');

    const files = collectScanUploadFiles(path.join(dir, 'dataflow.json'));

    expect(files.map((file) => file.relativePath)).toEqual([
      'facts.json',
      'data-items/email.json',
      'data-items/phone.json',
      'graphify.json',
      'answers.json',
    ]);
    expect(files[0].content).toBe('{"schemaVersion":1}');
  });

  it('leaves out answers.json and graphify.json when they do not exist', () => {
    fs.writeFileSync(path.join(dir, 'facts.json'), '{"schemaVersion":1}');
    const files = collectScanUploadFiles(path.join(dir, 'dataflow.json'));
    expect(files.map((file) => file.relativePath)).toEqual(['facts.json']);
  });

  it('skips a file that is not a JSON object, and ignores the old layout', () => {
    fs.writeFileSync(path.join(dir, 'facts.json'), 'not json');
    fs.mkdirSync(path.join(dir, 'ocsf-discoveries'));
    fs.writeFileSync(path.join(dir, 'ocsf-discoveries', 'a.json'), '{}');
    fs.writeFileSync(path.join(dir, 'dataparade-graph.json'), '{}');
    expect(collectScanUploadFiles(path.join(dir, 'dataflow.json'))).toEqual([]);
  });

  it('packs many small data item files into few requests and splits a large graphify.json', () => {
    fs.writeFileSync(path.join(dir, 'facts.json'), '{"schemaVersion":1}');
    fs.mkdirSync(path.join(dir, 'data-items'));
    for (let index = 0; index < 5; index += 1) {
      fs.writeFileSync(path.join(dir, 'data-items', `item-${index}.json`), `{"n":${index}}`);
    }
    const big = JSON.stringify({ nodes: [{ id: 'x'.repeat(SCAN_UPLOAD_MAX_JSON_BYTES * 2) }] });
    fs.writeFileSync(path.join(dir, 'graphify.json'), big);

    const requests = packScanUploadRequests(collectScanUploadFiles(path.join(dir, 'dataflow.json')));

    const batches = requests.filter((request): request is { files: Array<{ relativePath: string; content: string }> } => 'files' in request);
    const parts = requests.filter((request) => 'part' in request);
    expect(batches[0].files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining(['facts.json', 'data-items/item-0.json', 'data-items/item-4.json'])
    );
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const request of requests) {
      expect(Buffer.byteLength(JSON.stringify(request), 'utf8')).toBeLessThanOrEqual(SCAN_UPLOAD_MAX_JSON_BYTES);
    }
  });
});
