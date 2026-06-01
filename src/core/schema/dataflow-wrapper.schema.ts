import { z } from "zod";
import { diagramGraphJsonSchema } from "./diagram-graph.schema";

const terraformMetadataSchema = z
  .object({
    mode: z.enum(["static_tf", "json_overlay", "json_only"]),
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

export function validateDataflowJson(input: unknown):
  | { ok: true; value: DataflowWrapperSchema }
  | { ok: false; errors: string[] } {
  const result = dataflowWrapperSchema.safeParse(input);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    return { ok: false, errors };
  }

  return { ok: true, value: result.data };
}

