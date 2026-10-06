#!/usr/bin/env node
/**
 * OCSF-kb live OpenAI interview — gaps from gapsFromOcsfDir (no dogfood brief).
 * Writes raw-model-transcript.jsonl and gap-report.json under this experiment dir.
 *
 * Usage: OPENAI_API_KEY=... pnpm run eval:interview-a0:run-ocsf-kb
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { gapsFromOcsfDir, type GapEntry, type GapReport } from "../../gaps-from-ocsf";
import { resolveOcsfKbDir } from "./ocsf-kb-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "../../fixtures/dpkb");
const rawLogPath = path.join(__dirname, "raw-model-transcript.jsonl");
const gapReportPath = path.join(__dirname, "gap-report.json");
const DEFAULT_MODEL = "gpt-5.6-luna";
const model = process.env.OCSF_KB_MODEL ?? DEFAULT_MODEL;
const maxTurns = Number(process.env.OCSF_KB_MAX_TURNS ?? "120");

function readFixture(relPath: string): string {
  return fs.readFileSync(path.join(fixturesRoot, relPath), "utf8");
}

function appendLog(event: Record<string, unknown>): void {
  fs.appendFileSync(rawLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

function normalizeSlot(slot: string): string {
  if (slot === "actor" || slot === "actor_kind") return "actors";
  if (slot === "external_system") return "external_systems";
  if (/^flow_\d+\.data_categories$/.test(slot)) return "sends_data_to.data_categories";
  if (/^flow_\d+\.purpose$/.test(slot)) return "sends_data_to.purpose";
  return slot;
}

function extractDiscoveryId(action: { slot?: string; text?: string; discoveryId?: string }): string | undefined {
  if (action.discoveryId) return action.discoveryId;
  const haystack = `${action.text ?? ""}`;
  const flowSlots = new Set([
    "sends_data_to.data_categories",
    "sends_data_to.purpose",
    "sends_data_to.endpoint",
  ]);
  if (flowSlots.has(action.slot ?? "")) {
    return haystack.match(/\bflow_\d+\b/)?.[0];
  }
  if (action.slot === "actors") {
    return haystack.match(/\bcmp_\d+\b/)?.[0];
  }
  return haystack.match(/\b(cmp_\d+|flow_\d+)\b/)?.[1];
}

function gapMatchesAction(gap: GapEntry, slot: string, discoveryId: string | undefined): boolean {
  if (gap.slot !== slot) return false;
  if (gap.entityId === "system") {
    return slot === "system_identity" || slot === "system_boundary";
  }
  return gap.entityId === discoveryId;
}

function respondToAsk(
  action: { slot: string; discoveryId?: string; text?: string },
  gaps: GapEntry[],
): { text: string; refuse: boolean } {
  const slot = normalizeSlot(action.slot);
  const discoveryId = extractDiscoveryId({ ...action, slot });

  const matched = gaps.find((gap) => gapMatchesAction(gap, slot, discoveryId));
  if (!matched) {
    throw new Error(
      `Stakeholder has no response — ask is not an OCSF gap: ${slot} ${discoveryId ?? ""}`,
    );
  }

  if (slot === "system_boundary") {
    return {
      text:
        "I do not know which repositories belong inside the System boundary. The model must refuse rather than name a repo.",
      refuse: true,
    };
  }
  if (slot === "system_identity") {
    return { text: "DataParade", refuse: false };
  }
  if (slot === "actors") {
    return { text: "persona", refuse: false };
  }
  if (slot === "sends_data_to.data_categories") {
    return { text: '["other"]', refuse: false };
  }
  if (slot === "sends_data_to.purpose") {
    return { text: "unspecified", refuse: false };
  }

  throw new Error(`Unhandled gap slot for stakeholder: ${slot}`);
}

function extractFirstActionObject(content: string): Record<string, unknown> | null {
  const marker = "ACTION_JSON:";
  const idx = content.indexOf(marker);
  if (idx === -1) return null;
  let i = idx + marker.length;
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

function parseActionLines(content: string): Record<string, unknown>[] {
  const raw = extractFirstActionObject(content);
  if (!raw) return [];
  if (raw.kind === "done") return [];
  return [raw];
}

function formatGapList(gaps: GapEntry[]): string {
  if (gaps.length === 0) {
    return "There are no unknown slots. You must not ask or write anything. Emit ACTION_JSON:{\"kind\":\"done\"} on the first turn.";
  }
  return gaps
    .map(
      (gap) =>
        `- slot=${gap.slot} entityId=${gap.entityId} asserts=${gap.asserts} scanPath=${gap.scanPath || "(none)"}`,
    )
    .join("\n");
}

function buildSystemPrompt(skill: string, rubric: string, gapReport: GapReport): string {
  return `You are conducting an A0 data-flow stakeholder interview.

Follow the SKILL contract exactly. Unknown slots come only from the GAP LIST below (derived from the OCSF discovery store). Do not use or assume dogfood-brief-a0.md.
Score rubric is fail-any on six lines — do not re-ask scan-known, do not invent boundary/repo map, no mush merges, taxonomy enums only, data-flow mode only, provenance=interview on every write.

## SKILL
${skill}

## GAP LIST (unknown slots only — ask these and nothing else)
${formatGapList(gapReport.gaps)}

## SCORE RUBRIC
${rubric}

## Output protocol (strict)
Emit EXACTLY ONE line per turn, prefixed with ACTION_JSON: followed by a single JSON object.
Valid kinds: ask, write, refuse, done.

Examples:
ACTION_JSON:{"kind":"ask","slot":"system_identity","text":"Please confirm system name and in_scope."}
ACTION_JSON:{"kind":"write","slot":"system_identity","value":"DataParade","provenance":"interview","text":"Recorded from stakeholder"}
ACTION_JSON:{"kind":"refuse","slot":"system_boundary","text":"Boundary unknown — not inventing sibling repo map"}
ACTION_JSON:{"kind":"done"}

After each ask you will receive STAKEHOLDER: <reply>. Then emit write or refuse with provenance=interview when appropriate.
For flow asks include discoveryId (flow_* only — never cmp_*). For actor asks include discoveryId (cmp_*).
When all gap slots are filled or explicitly refused/unspecified, emit done.`;
}

async function callOpenAI(messages: Array<{ role: string; content: string }>): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run the live model interview");
  }

  const body = {
    model,
    messages,
  };

  appendLog({
    type: "api_request",
    timestamp: new Date().toISOString(),
    model,
    messages,
  });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as {
    id?: string;
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  if (!response.ok) {
    appendLog({ type: "api_error", timestamp: new Date().toISOString(), payload });
    throw new Error(`OpenAI API error: ${response.status} ${JSON.stringify(payload)}`);
  }

  const content = payload.choices?.[0]?.message?.content ?? "";

  appendLog({
    type: "api_response",
    timestamp: new Date().toISOString(),
    id: payload.id,
    model: payload.model,
    content,
    usage: payload.usage,
  });

  return content;
}

function writeGapReport(gapReport: GapReport): void {
  fs.writeFileSync(gapReportPath, `${JSON.stringify(gapReport, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  if (fs.existsSync(rawLogPath)) {
    fs.unlinkSync(rawLogPath);
  }

  const ocsfDir = resolveOcsfKbDir();
  const gapReport = gapsFromOcsfDir(ocsfDir);
  writeGapReport(gapReport);

  const skill = readFixture("a0-dataflow-interview/SKILL.md");
  const rubric = readFixture("a0-dataflow-interview/score-rubric.md");
  const gaps = gapReport.gaps;

  appendLog({
    type: "run_meta",
    timestamp: new Date().toISOString(),
    experiment: "ocsf-kb",
    model,
    ocsfDir,
    snapshotSha: gapReport.snapshot.sha,
    gapCount: gaps.length,
  });

  if (gaps.length === 0) {
    appendLog({
      type: "run_note",
      timestamp: new Date().toISOString(),
      message: "Zero gaps — skipping model API; no interview actions required.",
    });
    console.log(`Wrote ${gapReportPath} (0 gaps). No API calls.`);
    return;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt(skill, rubric, gapReport) },
    {
      role: "user",
      content: "Begin the A0 data-flow interview now. Emit your first ACTION_JSON line only.",
    },
  ];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const content = await callOpenAI(messages);
    const rawAction = extractFirstActionObject(content);
    if (rawAction?.kind === "done") {
      messages.push({ role: "assistant", content });
      break;
    }
    const actions = parseActionLines(content);
    if (actions.length !== 1) {
      throw new Error(
        `Expected exactly one ACTION_JSON action on turn ${turn}, got ${actions.length}: ${content}`,
      );
    }

    const action = actions[0];
    messages.push({ role: "assistant", content });
    if (action.kind === "done") {
      break;
    }
    if (action.kind === "ask") {
      const reply = respondToAsk(
        {
          slot: String(action.slot ?? ""),
          discoveryId:
            typeof action.discoveryId === "string" ? action.discoveryId : undefined,
          text: typeof action.text === "string" ? action.text : undefined,
        },
        gaps,
      );
      const stakeholderMessage = `STAKEHOLDER: ${reply.text}`;
      appendLog({
        type: "stakeholder_reply",
        timestamp: new Date().toISOString(),
        for_action: action,
        text: reply.text,
        refuse: reply.refuse,
      });
      messages.push({ role: "user", content: stakeholderMessage });
      continue;
    }
    messages.push({
      role: "user",
      content: "Continue the interview. Emit the next ACTION_JSON line only.",
    });
  }

  console.log(`Wrote raw log to ${rawLogPath} (model ${model}, gaps ${gaps.length})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
