import { z } from "zod";

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(0.1).max(4),
});

export const nodeDataSchema = z
  .object({
    label: z.string().min(1).max(255),
    description: z.string().optional(),
    // Privacy / security / engineering are kept flexible to avoid tight coupling.
    privacy: z.record(z.string(), z.unknown()).optional(),
    security: z.record(z.string(), z.unknown()).optional(),
    engineering: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

export const diagramNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    position: z.object({
      x: z.number(),
      y: z.number(),
    }),
    data: nodeDataSchema,
    selected: z.boolean().optional(),
  })
  .catchall(z.unknown());

export const edgeDataSchema = z
  .object({
    label: z.string().optional(),
    privacy: z.record(z.string(), z.unknown()).optional(),
    security: z.record(z.string(), z.unknown()).optional(),
    narrative: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown());

export const diagramEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    type: z.string().optional(),
    data: edgeDataSchema.optional(),
    selected: z.boolean().optional(),
  })
  .catchall(z.unknown());

export const diagramGraphJsonSchema = z.object({
  nodes: z.array(diagramNodeSchema),
  edges: z.array(diagramEdgeSchema),
  viewport: viewportSchema.optional(),
});

export type ViewportSchema = z.infer<typeof viewportSchema>;
export type NodeDataSchema = z.infer<typeof nodeDataSchema>;
export type DiagramNodeSchema = z.infer<typeof diagramNodeSchema>;
export type EdgeDataSchema = z.infer<typeof edgeDataSchema>;
export type DiagramEdgeSchema = z.infer<typeof diagramEdgeSchema>;
export type DiagramGraphJsonSchema = z.infer<typeof diagramGraphJsonSchema>;

