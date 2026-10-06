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

const SLOT_ALIASES: Record<string, InterviewSlot> = {
  actor: "actors",
  actor_kind: "actors",
  external_system: "external_systems",
  data_categories: "sends_data_to.data_categories",
  purpose: "sends_data_to.purpose",
};

function normalizeSlot(slot: string, kind: InterviewActionKind): InterviewSlot | null {
  let aliased = SLOT_ALIASES[slot] ?? slot;
  if (/^flow_\d+\.data_categories$/.test(aliased)) {
    aliased = "sends_data_to.data_categories";
  }
  if (/^flow_\d+\.purpose$/.test(aliased)) {
    aliased = "sends_data_to.purpose";
  }
  if (!VALID_SLOTS.has(aliased as InterviewSlot)) {
    if (kind === "ask") {
      return null;
    }
    throw new Error(`Invalid action slot: ${slot}`);
  }
  return aliased as InterviewSlot;
}

export interface RawLogEvent {
  type: string;
  content?: string;
  model?: string;
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
  if (typeof slot !== "string") {
    throw new Error(`Invalid action slot in ${sourceLine}`);
  }

  const normalizedSlot = normalizeSlot(slot, kind as InterviewActionKind);
  if (!normalizedSlot) {
    return null;
  }

  const action: InterviewAction = {
    kind: kind as InterviewActionKind,
    slot: normalizedSlot,
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

function extractFirstActionObject(content: string): Record<string, unknown> | null {
  const idx = content.indexOf(ACTION_PREFIX);
  if (idx === -1) return null;
  let i = idx + ACTION_PREFIX.length;
  while (i < content.length && /\s/.test(content[i])) i += 1;
  if (content[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < content.length; j += 1) {
    if (content[j] === "{") depth += 1;
    if (content[j] === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(content.slice(i, j + 1)) as Record<string, unknown>;
      }
    }
  }
  return null;
}

export function extractActionLinesFromContent(content: string): InterviewAction[] {
  const raw = extractFirstActionObject(content);
  if (!raw) return [];
  const action = parseActionObject(raw, content);
  return action ? [action] : [];
}

export function mapRawLogToActions(
  rawLogPath: string,
  interviewId = "ocsf-kb-mapped-from-raw",
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
      "Mechanical mapper output from raw-model-transcript.jsonl (ocsf-kb). Not hand-edited.",
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
