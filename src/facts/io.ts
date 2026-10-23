import fs from "fs";
import path from "path";

import {
  answersFileSchema,
  dataItemFileSchema,
  factsFileSchema,
  SCHEMA_VERSION,
  type Answer,
  type AnswersFile,
  type DataItemFile,
  type FactsFile,
} from "./schema";
import type { OutputLayout } from "./layout";

export class FactsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FactsError";
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Write the Facts of a scan. facts.json and data-items/ are replaced as a whole, so
 * nothing from an earlier scan stays behind. answers.json is never read or written here.
 */
export function writeFactsOutput(layout: OutputLayout, facts: FactsFile, dataItemFiles: Map<string, DataItemFile>): void {
  factsFileSchema.parse(facts);
  fs.rmSync(layout.dataItemsDir, { recursive: true, force: true });
  fs.mkdirSync(layout.dataItemsDir, { recursive: true });
  for (const [relativePath, file] of dataItemFiles) {
    writeJson(path.join(layout.dir, relativePath), dataItemFileSchema.parse(file));
  }
  writeJson(layout.factsPath, facts);
}

export function readFacts(layout: OutputLayout): FactsFile {
  if (!fs.existsSync(layout.factsPath)) {
    throw new FactsError(
      "NO_KB",
      `No facts.json in ${layout.dir}. Scan first: dataparade scan <repo> -o ${layout.dataflowPath}`,
    );
  }
  return factsFileSchema.parse(JSON.parse(fs.readFileSync(layout.factsPath, "utf8")));
}

/** All data item files named by facts.json, in the order of facts.dataItems. */
export function readDataItemFiles(layout: OutputLayout, facts: FactsFile): DataItemFile[] {
  return facts.dataItems.map((item) => {
    const filePath = path.join(layout.dir, item.file);
    if (!fs.existsSync(filePath)) {
      throw new FactsError("MISSING_DATA_ITEM_FILE", `facts.json names ${item.file}, which does not exist in ${layout.dir}.`);
    }
    return dataItemFileSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
  });
}

export function readAnswers(layout: OutputLayout): AnswersFile {
  if (!fs.existsSync(layout.answersPath)) return { schemaVersion: SCHEMA_VERSION, answers: [] };
  return answersFileSchema.parse(JSON.parse(fs.readFileSync(layout.answersPath, "utf8")));
}

/** Append answers to answers.json (created when missing). Existing answers are kept as they are. */
export function appendAnswers(layout: OutputLayout, answers: Answer[]): AnswersFile {
  const file = readAnswers(layout);
  const next: AnswersFile = { schemaVersion: SCHEMA_VERSION, answers: [...file.answers, ...answers] };
  writeJson(layout.answersPath, answersFileSchema.parse(next));
  return next;
}
