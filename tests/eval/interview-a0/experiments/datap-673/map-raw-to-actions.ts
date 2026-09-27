import fs from "fs";

import type {
  InterviewAction,
  InterviewActionKind,
  InterviewSlot,
  Provenance,
  SimulatedInterview,
} from "../../types";

const ACTION_PREFIX = "ACTION_JSON:";

const VALID_SLOTS = new Set<InterviewSlot>([
  "system_identity",
  "system_boundary",
  "actors",
  "external_systems",
  "sends_data_to.endpoint",
  "sends_data_to.data_categories",
  "sends_data_to.purpose",
  "interacts_with",
  "deploy_topology",
  "container_box",
]);

const VALID_KINDS = new Set<InterviewActionKind>(["ask", "write", "refuse"]);

export interface RawLogEvent {
  type: string;
  content?: string;
  [key: string]: unknown;
}

function parseActionObject(raw: Record<string, unknown>, sourceLine: string): InterviewAction | null {
  const kind = raw.kind;
  if (kind === "done") {
    return null;
  }
  if (typeof kind !== "string" || !VALID_KINDS.has(kind as InterviewActionKind)) {
    throw new Error(`Invalid action kind in ${sourceLine}`);
  }
  const slot = raw.slot;
  if (typeof slot !== "string" || !VALID_SLOTS.has(slot as InterviewSlot)) {
    throw new Error(`Invalid action slot in ${sourceLine}`);
  }

  const action: InterviewAction = {
    kind: kind as InterviewActionKind,
    slot: slot as InterviewSlot,
  };

  if (typeof raw.discoveryId === "string") {
    action.discoveryId = raw.discoveryId;
  }
  if (typeof raw.text === "string") {
    action.text = raw.text;
  }
  if (raw.value !== undefined) {
    action.value = Array.isArray(raw.value)
      ? raw.value.map(String)
      : String(raw.value);
  }
  if (typeof raw.provenance === "string") {
    action.provenance = raw.provenance as Provenance;
  }

  return action;
}

export function extractActionLinesFromContent(content: string): InterviewAction[] {
  const actions: InterviewAction[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(ACTION_PREFIX)) {
      continue;
    }
    const jsonText = trimmed.slice(ACTION_PREFIX.length).trim();
    const raw = JSON.parse(jsonText) as Record<string, unknown>;
    const action = parseActionObject(raw, trimmed);
    if (action) {
      actions.push(action);
    }
  }
  return actions;
}

export function mapRawLogToActions(
  rawLogPath: string,
  interviewId = "datap-673-mapped-from-raw",
): SimulatedInterview {
  const lines = fs.readFileSync(rawLogPath, "utf8").split("\n").filter(Boolean);
  const actions: InterviewAction[] = [];

  for (const line of lines) {
    const event = JSON.parse(line) as RawLogEvent;
    if (event.type !== "api_response" || typeof event.content !== "string") {
      continue;
    }
    actions.push(...extractActionLinesFromContent(event.content));
  }

  return {
    id: interviewId,
    description:
      "Mechanical mapper output from raw-model-transcript.jsonl (DATAP-673). Not hand-edited.",
    actions,
  };
}

export function mapRawLogToInterviewFile(
  rawLogPath: string,
  outputPath: string,
  interviewId?: string,
): SimulatedInterview {
  const interview = mapRawLogToActions(rawLogPath, interviewId);
  fs.writeFileSync(outputPath, `${JSON.stringify(interview, null, 2)}\n`, "utf8");
  return interview;
}
