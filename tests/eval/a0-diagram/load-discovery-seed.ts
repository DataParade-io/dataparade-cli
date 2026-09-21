import fs from "fs";
import { z } from "zod";

const sourceLocationSchema = z.object({
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  code: z.string().optional(),
});

const discoverySeedComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  subType: z.string(),
  confidence: z.number(),
  sourceLocations: z.array(sourceLocationSchema),
});

const discoverySeedDataFlowSchema = z.object({
  id: z.string(),
  sourceComponentId: z.string(),
  targetComponentId: z.string(),
  type: z.string(),
  confidence: z.number(),
  targetScope: z.string().optional(),
  sourceLocation: sourceLocationSchema.optional(),
});

export const discoverySeedSchema = z.object({
  components: z.array(discoverySeedComponentSchema),
  dataFlows: z.array(discoverySeedDataFlowSchema),
});

export type DiscoverySeed = z.infer<typeof discoverySeedSchema>;

export function loadDiscoverySeedFromFile(filePath: string): DiscoverySeed {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const result = discoverySeedSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid discovery seed: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.data;
}
