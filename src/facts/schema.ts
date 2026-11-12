/**
 * The DataParade knowledge base format, schema v1.
 *
 * A scan writes Facts: components, data flows, data items (with their groups and
 * occurrences). People's decisions are Answers, kept apart so a rescan never loses them.
 * See docs/cli/scan-output.md.
 */
import { fingerprintSchema } from "@dataparade/kb-compare";
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

/**
 * What a Fact is, independent of the scan that found it (DATAP-842). Two scans of the
 * same code give the same identity, so comparisons match Facts by it.
 *
 * - `key`: the canonical key. For components and flows it is the string the scanner hashes
 *   into the id (`cmp_`/`flow_` + 12 hex of sha256). For data items it is the name; for
 *   groups, the group id, except that a group named after a declaration
 *   (`email@src/a.js:12#email`) drops the line (`email@src/a.js#email`). Keys never contain
 *   the scan root or a line number.
 * - `parts`: the values the key is made of, for display and for matching renamed Facts.
 *
 * Duplicate keys (DATAP-845). When several Facts of one kind share a key, the scanner
 * orders them by source position, then by content. The first keeps the key and the plain
 * id; the n-th gets `#n` on the key, `_n` on the id, and `duplicateIndex: n`. A name can
 * itself end in `#<digits>`, so read the number from `duplicateIndex`, never from the key:
 * the base key is the key without `#<duplicateIndex>`. Groups that share a key are
 * numbered by declaration line. Because the order depends on source position, a
 * duplicate's number can change when code moves. Comparisons must match Facts that share
 * a base key as one group,
 * never by their number. Measured on 10 Nov 2026: 0 duplicates in 73 scans of the
 * DataParade monorepo, Saleor and synthetic edits (about 2,100 components, 2,000 flows).
 *
 * Optional only so knowledge bases from CLI 0.0.32 and earlier still read.
 */
export const identitySchema = z.object({
  kind: z.enum(["component", "dataFlow", "dataItem", "group"]),
  key: z.string(),
  parts: z.record(z.string(), z.string()),
  duplicateIndex: z.number().int().min(2).optional(),
});

export const componentFactSchema = z.object({
  id: z.string(),
  identity: identitySchema.optional(),
  name: z.string(),
  type: z.string(),
  subType: z.string(),
  confidence: z.number(),
  sourceLocations: z.array(sourceLocationSchema),
  codeRefs: z.array(codeRefSchema),
});

export const dataFlowFactSchema = z.object({
  id: z.string(),
  identity: identitySchema.optional(),
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
  identity: identitySchema.optional(),
  label: z.string(),
  /** The evidence that named the group (column, record-key, name, ...). */
  basis: z.string().optional(),
  occurrenceCount: z.number(),
  handledBy: z.array(z.string()),
});

export const dataItemSummarySchema = z.object({
  id: z.string(),
  identity: identitySchema.optional(),
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

/**
 * Scan stamps (DATAP-876). Two scans can be compared only when their tool stamps are equal,
 * neither had AI enrichment, and neither checkout was dirty (DATAP-877). `structureGraph` says
 * whether Graphify ran; it is information only, because Graphify is optional.
 * - `scannerCommit`, `catalogHash`: the bundled scanner and its pattern catalog.
 * - `configHash`: the settings that change the output (excludes, languages, depths, detection
 *   switches, organization domains, minimum confidence, Terraform inputs).
 * - Git: `commitSha`, `dirty`, `rootCommitSha` (null in a shallow clone), and `scanRoot`, the scan
 *   root relative to the repository root. All null when the folder is not in Git and no
 *   --git-context was given.
 */
export const scanStampsSchema = z.object({
  scannerCommit: z.string(),
  cliVersion: z.string(),
  catalogHash: z.string(),
  configHash: z.string(),
  aiInference: z.boolean(),
  structureGraph: z.boolean(),
  commitSha: z.string().nullable(),
  dirty: z.boolean().nullable(),
  rootCommitSha: z.string().nullable(),
  scanRoot: z.string().nullable(),
});

export const factsFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  scan: z.object({
    projectName: z.string(),
    scannedAt: z.string(),
    cliVersion: z.string(),
    scannerVersion: z.string(),
    /** Absent in scans from CLI 0.0.32 and earlier; such scans cannot be compared. */
    stamps: scanStampsSchema.optional(),
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
  identity: identitySchema.optional(),
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
  /**
   * The answer's element by identity (DATAP-873): its `identity.key`, or `dp:a0/system` for an
   * answer about the whole system. Lets a later scan find the element after its id changes.
   */
  identityKey: z.string().optional(),
  /** The element's evidence fingerprint when the answer was given (kb-compare `fingerprintSchema`). */
  fingerprint: fingerprintSchema.optional(),
  /** `landed`: computed when the answer was landed. `migrated`: added later from the cited brief and a later scan. */
  fingerprintSource: z.enum(["landed", "migrated"]).optional(),
});

export const answersFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  answers: z.array(answerSchema),
});

export type Identity = z.infer<typeof identitySchema>;
export type ScanStamps = z.infer<typeof scanStampsSchema>;
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
