import type { ScanUploadFile } from './collect-scan-sidecars';

/**
 * JSON body size for one upload request.
 * API Gateway stops the caller at 29 seconds, and a graph part of about
 * 2.3 MB kept the dev Lambda running for about 53 seconds.
 * 700 KB stays under a 20 second budget and under the 4 MB body ceiling.
 */
export const SCAN_UPLOAD_MAX_JSON_BYTES = 700_000;

/** How many small Fact files to put in one request. */
export const SCAN_UPLOAD_MAX_FILES_PER_REQUEST = 200;

export type ScanUploadFilePart = {
  relativePath: string;
  partIndex: number;
  partCount: number;
  content: string;
};

export type ScanUploadRequest =
  | { files: Array<{ relativePath: string; content: string }> }
  | { part: ScanUploadFilePart };

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function endOnCodePoint(text: string, end: number): number {
  if (end <= 0 || end >= text.length) return end;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) return end - 1;
  return end;
}

function partRequest(
  relativePath: string,
  partIndex: number,
  partCount: number,
  content: string
): ScanUploadRequest {
  return { part: { relativePath, partIndex, partCount, content } };
}

/**
 * Split one file into parts whose JSON bodies fit the gateway.
 * partCount is filled in after the slices are known.
 */
export function splitScanUploadFile(
  file: ScanUploadFile,
  maxJsonBytes = SCAN_UPLOAD_MAX_JSON_BYTES
): ScanUploadFilePart[] {
  const slices: string[] = [];
  let offset = 0;
  const text = file.content;
  if (text.length === 0) {
    return [
      {
        relativePath: file.relativePath,
        partIndex: 0,
        partCount: 1,
        content: '',
      },
    ];
  }

  while (offset < text.length) {
    let end = text.length;
    let content = text.slice(offset, endOnCodePoint(text, end));
    while (
      jsonBytes(
        partRequest(file.relativePath, slices.length, 1_000_000, content)
      ) > maxJsonBytes
    ) {
      if (end - offset <= 1) {
        throw new Error(
          `Scan file ${file.relativePath} has a character that does not fit in one upload request.`
        );
      }
      end = offset + Math.max(1, Math.floor((end - offset) / 2));
      end = endOnCodePoint(text, end);
      if (end <= offset) end = offset + 1;
      content = text.slice(offset, end);
    }
    slices.push(content);
    offset = end;
  }

  return slices.map((content, partIndex) => ({
    relativePath: file.relativePath,
    partIndex,
    partCount: slices.length,
    content,
  }));
}

function fileRequestFits(
  files: Array<{ relativePath: string; content: string }>,
  extra: ScanUploadFile,
  maxJsonBytes: number
): boolean {
  if (files.length + 1 > SCAN_UPLOAD_MAX_FILES_PER_REQUEST) return false;
  return (
    jsonBytes({
      files: [...files, { relativePath: extra.relativePath, content: extra.content }],
    }) <= maxJsonBytes
  );
}

/**
 * Pack scan files into requests the gateway can accept.
 * A file that fits goes with other small files. A larger file is split into parts.
 */
export function packScanUploadRequests(
  files: ScanUploadFile[],
  maxJsonBytes = SCAN_UPLOAD_MAX_JSON_BYTES
): ScanUploadRequest[] {
  const requests: ScanUploadRequest[] = [];
  let batch: Array<{ relativePath: string; content: string }> = [];

  const flush = () => {
    if (batch.length === 0) return;
    requests.push({ files: batch });
    batch = [];
  };

  for (const file of files) {
    if (fileRequestFits(batch, file, maxJsonBytes)) {
      batch.push({ relativePath: file.relativePath, content: file.content });
      continue;
    }
    flush();
    if (fileRequestFits([], file, maxJsonBytes)) {
      batch.push({ relativePath: file.relativePath, content: file.content });
      continue;
    }
    for (const part of splitScanUploadFile(file, maxJsonBytes)) {
      requests.push({ part });
    }
  }
  flush();
  return requests;
}
