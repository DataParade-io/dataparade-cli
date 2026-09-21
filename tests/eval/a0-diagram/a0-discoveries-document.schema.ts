import { z } from "zod";

export const a0DiscoveriesComponentSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  actor_kind: z.string().optional(),
});

export const a0DiscoveriesDataFlowSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  data_categories: z.array(z.string()).optional(),
  purpose: z.string().optional(),
});

export const a0DiscoveriesDocumentSchema = z.object({
  components: z.array(a0DiscoveriesComponentSchema),
  dataFlows: z.array(a0DiscoveriesDataFlowSchema),
  dataItems: z.array(z.unknown()),
  mentions: z.array(z.unknown()),
  system: z
    .object({
      in_scope: z.string().optional(),
    })
    .optional(),
});

export type A0DiscoveriesDocument = z.infer<typeof a0DiscoveriesDocumentSchema>;

export function validateA0DiscoveriesDocument(
  value: unknown,
): { ok: true; value: A0DiscoveriesDocument } | { ok: false; errors: string[] } {
  const result = a0DiscoveriesDocumentSchema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  };
}
