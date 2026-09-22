import { z } from "zod";

const personalDataMentionInputSchema = z.object({
  id: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  code: z.string().optional(),
});

const personalDataDataItemInputSchema = z.object({
  id: z.string(),
  mentionId: z.string(),
});

export const personalDataProjectionInputSchema = z.object({
  mentions: z.array(personalDataMentionInputSchema),
  dataItems: z.array(personalDataDataItemInputSchema),
});

export type PersonalDataProjectionInput = z.infer<typeof personalDataProjectionInputSchema>;
