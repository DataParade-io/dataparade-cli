import { z } from 'zod';
import { diagramGraphJsonSchema } from './diagram-graph.schema';

/**
 * Git repository context for evidence linking.
 * Enables converting file paths in evidence to clickable GitHub/GitLab URLs.
 */
export const gitContextSchema = z.object({
  /** Git provider: github or gitlab */
  provider: z.enum(['github', 'gitlab']),
  /** Repository in "owner/repo" format */
  repository: z.string().min(1),
  /** Resolved commit SHA (40 character hex string) */
  commitSha: z.string().regex(/^[a-f0-9]{40}$/i, 'Must be a 40-character SHA'),
  /** Base URL for self-hosted instances (e.g., "https://gitlab.mycompany.com"). Defaults to public GitHub/GitLab. */
  baseUrl: z.string().url().optional(),
});

export type GitContextSchema = z.infer<typeof gitContextSchema>;

const terraformMetadataSchema = z
  .object({
    mode: z.enum(['static_tf', 'json_overlay', 'json_only']),
    staticTfFiles: z.number().int().nonnegative(),
    jsonInputPath: z.string().optional(),
    jsonFindingsMerged: z.number().int().nonnegative(),
  })
  .strict();

export const dataflowMetadataSchema = z
  .object({
    componentsCount: z.number().int().nonnegative().optional(),
    dataFlowsCount: z.number().int().nonnegative().optional(),
    filesScanned: z.number().int().nonnegative().optional(),
    scanDurationMs: z.number().int().nonnegative().optional(),
    terraform: terraformMetadataSchema.optional(),
    /** Git repository context for evidence linking (GitHub/GitLab URLs) */
    gitContext: gitContextSchema.optional(),
  })
  .passthrough();

export const dataflowWrapperSchema = z.object({
  schemaVersion: z.string().min(1),
  graph: diagramGraphJsonSchema,
  metadata: dataflowMetadataSchema.optional(),
});

export type DataflowMetadataSchema = z.infer<typeof dataflowMetadataSchema>;
export type DataflowWrapperSchema = z.infer<typeof dataflowWrapperSchema>;

export function parseDataflowJson(input: unknown): DataflowWrapperSchema {
  return dataflowWrapperSchema.parse(input);
}

export function validateDataflowJson(
  input: unknown
):
  | { ok: true; value: DataflowWrapperSchema }
  | { ok: false; errors: string[] } {
  const result = dataflowWrapperSchema.safeParse(input);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`
    );
    return { ok: false, errors };
  }

  return { ok: true, value: result.data };
}
