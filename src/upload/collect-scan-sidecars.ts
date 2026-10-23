import fs from 'fs';
import path from 'path';

import {
  ANSWERS_BASENAME,
  DATA_ITEMS_DIRNAME,
  FACTS_BASENAME,
  GRAPHIFY_BASENAME,
  layoutForDir,
} from '../facts/layout';

/** One scan file, as it was written on disk, ready to upload on its own. */
export type ScanUploadFile = {
  relativePath: string;
  content: string;
};

function readTextIfPresent(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function isJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * The scan files to upload after dataflow.json: facts.json, every data-items/*.json,
 * graphify.json, and answers.json. A file that is missing or is not a JSON object is left out.
 */
export function collectScanUploadFiles(
  dataflowFilePath: string
): ScanUploadFile[] {
  const layout = layoutForDir(path.dirname(path.resolve(dataflowFilePath)));
  const files: ScanUploadFile[] = [];
  const add = (relativePath: string, absolutePath: string) => {
    const content = readTextIfPresent(absolutePath);
    if (content !== undefined && isJsonObject(content)) {
      files.push({ relativePath, content });
    }
  };

  add(FACTS_BASENAME, layout.factsPath);

  let names: string[] = [];
  try {
    names = fs
      .readdirSync(layout.dataItemsDir)
      .filter((name) => name.endsWith('.json'));
  } catch {
    names = [];
  }
  names.sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    add(`${DATA_ITEMS_DIRNAME}/${name}`, path.join(layout.dataItemsDir, name));
  }

  add(GRAPHIFY_BASENAME, layout.graphifyPath);
  add(ANSWERS_BASENAME, layout.answersPath);
  return files;
}
