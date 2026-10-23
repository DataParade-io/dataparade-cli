/**
 * The DataParade knowledge base format, schema v1.
 *
 * A scan writes Facts: components, data flows, data items (with their groups and
 * occurrences). People's decisions are Answers, kept apart so a rescan never loses them.
 * See docs/cli/scan-output.md.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const sourceLocationSchema = z.object({
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
});

/** A link from a Fact to a node of the code-structure graph (graphify.json). */
export const codeRefSchema = z.object({
  nodeId: z.string(),
  kind: z.string().optional(),
  filePath: z.string().optional(),
  line: z.number().optional(),
});

export const componentFactSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  subType: z.string(),
  confidence: z.number(),
  sourceLocations: z.array(sourceLocationSchema),
  codeRefs: z.array(codeRefSchema),
});

export const dataFlowFactSchema = z.object({
  id: z.string(),
  sourceComponentId: z.string(),
  targetComponentId: z.string(),
  type: z.string(),
  targetScope: z.string().optional(),
  confidence: z.number(),
  sourceLocations: z.array(sourceLocationSchema),
  codeRefs: z.array(codeRefSchema),
});

export const dataItemGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** The evidence that named the group (column, record-key, name, ...). */
  basis: z.string().optional(),
  occurrenceCount: z.number(),
  handledBy: z.array(z.string()),
});

export const dataItemSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  labels: z.array(z.string()),
  occurrenceCount: z.number(),
  /** Path of this item's file, relative to the output folder: `data-items/<slug>.json`. */
  file: z.string(),
  groups: z.array(dataItemGroupSchema),
});

export const relationSchema = z.object({
  type: z.string(),
  source: z.string(),
  target: z.string(),
  confidence: z.string().optional(),
  basis: z.string().nullable().optional(),
});

export const factsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  scan: z.object({
    projectName: z.string(),
    scannedAt: z.string(),
    cliVersion: z.string(),
    scannerVersion: z.string(),
  }),
  components: z.array(componentFactSchema),
  dataFlows: z.array(dataFlowFactSchema),
  dataItems: z.array(dataItemSummarySchema),
  relations: z.array(relationSchema),
});

export const occurrenceFactSchema = z.object({
  id: z.string(),
  /** The group this occurrence belongs to, or null when the scanner could not tell. */
  groupId: z.string().nullable(),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  code: z.string().optional(),
  labels: z.array(z.string()),
  /** `comment` when the match sits only in a comment or docstring. */
  location: z.enum(["code", "comment"]).optional(),
  codeRefs: z.array(codeRefSchema),
  /** The same-file occurrence that declares the name this one uses. */
  declaredBy: z.object({ id: z.string(), kind: z.string().optional() }).optional(),
});

export const dataItemFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  labels: z.array(z.string()),
  groups: z.array(dataItemGroupSchema),
  occurrences: z.array(occurrenceFactSchema),
});

export const answerSchema = z.object({
  id: z.string(),
  factId: z.string(),
  action: z.enum(["set", "remove"]),
  property: z.string().optional(),
  value: z.unknown().optional(),
  by: z.string(),
  at: z.string(),
  source: z.enum(["interview", "review"]),
  /** Where the decision came from: an interview transcript path, or a note. */
  evidence: z.string().optional(),
  /** Interview answers: the KB snapshot the question was asked from, and the interview skill. */
  briefSha: z.string().optional(),
  skillSha: z.string().optional(),
});

export const answersFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  answers: z.array(answerSchema),
});

export type SourceLocation = z.infer<typeof sourceLocationSchema>;
export type CodeRef = z.infer<typeof codeRefSchema>;
export type ComponentFact = z.infer<typeof componentFactSchema>;
export type DataFlowFact = z.infer<typeof dataFlowFactSchema>;
export type DataItemGroup = z.infer<typeof dataItemGroupSchema>;
export type DataItemSummary = z.infer<typeof dataItemSummarySchema>;
export type Relation = z.infer<typeof relationSchema>;
export type FactsFile = z.infer<typeof factsFileSchema>;
export type OccurrenceFact = z.infer<typeof occurrenceFactSchema>;
export type DataItemFile = z.infer<typeof dataItemFileSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type AnswersFile = z.infer<typeof answersFileSchema>;
