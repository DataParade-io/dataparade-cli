#!/usr/bin/env node
/**
 * DATAP-673: live OpenAI interview run. Writes unedited API log to raw-model-transcript.jsonl.
 * Usage: OPENAI_API_KEY=... node run-model-interview.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "../../fixtures/dpkb");
const rawLogPath = path.join(__dirname, "raw-model-transcript.jsonl");
const model = process.env.DATAP_673_MODEL ?? "gpt-4o-mini";
const maxTurns = Number(process.env.DATAP_673_MAX_TURNS ?? "120");

function readFixture(relPath) {
  return fs.readFileSync(path.join(fixturesRoot, relPath), "utf8");
}

function appendLog(event) {
  fs.appendFileSync(rawLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

function loadStakeholderScript() {
  return YAML.parse(
    fs.readFileSync(path.join(__dirname, "stakeholder-script.yaml"), "utf8"),
  ).responses;
}

function extractDiscoveryId(action) {
  if (action.discoveryId) return action.discoveryId;
  const haystack = `${action.text ?? ""}`;
  const flowSlots = new Set([
    "sends_data_to.data_categories",
    "sends_data_to.purpose",
    "sends_data_to.endpoint",
  ]);
  if (flowSlots.has(action.slot)) {
    return haystack.match(/\bflow_\d+\b/)?.[0];
  }
  if (action.slot === "actors") {
    return haystack.match(/\bcmp_\d+\b/)?.[0];
  }
  return haystack.match(/\b(cmp_\d+|flow_\d+)\b/)?.[1];
}

function respondToAsk(action, responses) {
  const discoveryId = extractDiscoveryId(action);
  const match = responses.find((entry) => {
    if (entry.match.slot !== action.slot) return false;
    if (entry.match.discoveryId && entry.match.discoveryId !== discoveryId) return false;
    if (!entry.match.discoveryId && discoveryId) return false;
    return true;
  });
  if (!match) {
    if (
      action.slot.startsWith("sends_data_to.") &&
      !discoveryId
    ) {
      return {
        text:
          "Please ask per flow_* id from the brief (data_categories and purpose are per flow, not per cmp).",
        refuse: false,
      };
    }
    throw new Error(
      `No scripted stakeholder response for ${action.slot} ${discoveryId ?? ""}`,
    );
  }
  return {
    text: match.stakeholder_text ?? String(match.write_value ?? ""),
    refuse: Boolean(match.refuse),
  };
}

function parseActionLines(content) {
  const actions = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("ACTION_JSON:")) continue;
    const raw = JSON.parse(trimmed.slice("ACTION_JSON:".length).trim());
    if (raw.kind !== "done") actions.push(raw);
  }
  return actions;
}

function buildSystemPrompt(skill, brief, rubric) {
  return `You are conducting an A0 data-flow stakeholder interview.

Follow the SKILL contract exactly. Use the brief as authoritative for known vs unknown rows.
Score rubric is fail-any on six lines — do not re-ask scan-known, do not invent boundary/repo map, no mush merges, taxonomy enums only, data-flow mode only, provenance on every write.

## SKILL
${skill}

## BRIEF
${brief}

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
Do not ask about scan-known flow endpoints. Ask only unknown data_categories and purpose per flow_*.
Confirm partial-known actors cmp_6, cmp_17, cmp_20, cmp_25 only — each actors ask MUST include discoveryId.
For flow asks include discoveryId (flow_* only — never cmp_*). Ask system_boundary before refusing if stakeholder might know.
When all unknown A0 slots are filled or explicitly refused/unspecified, emit done.`;
}

async function callOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to run the live model interview");
  }

  const body = {
    model,
    temperature: 0,
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

  const payload = await response.json();
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

async function main() {
  if (fs.existsSync(rawLogPath)) {
    fs.unlinkSync(rawLogPath);
  }

  const skill = readFixture("a0-dataflow-interview/SKILL.md");
  const brief = readFixture("dogfood-brief-a0.md");
  const rubric = readFixture("a0-dataflow-interview/score-rubric.md");
  const stakeholderResponses = loadStakeholderScript();

  appendLog({
    type: "run_meta",
    timestamp: new Date().toISOString(),
    ticket: "DATAP-673",
    model,
    briefSha: "16f2e857a47d54bfea6ca5d7f23a6c4f2732da29",
    skillSha: "8175d44a8483fed5bca73efdf1c13c24aee06f58",
  });

  const messages = [
    { role: "system", content: buildSystemPrompt(skill, brief, rubric) },
    {
      role: "user",
      content:
        "Begin the A0 data-flow interview now. Emit your first ACTION_JSON line only.",
    },
  ];

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const content = await callOpenAI(messages);
    const actions = parseActionLines(content);
    if (actions.length === 0 && content.includes('"kind":"done"')) {
      break;
    }
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
      const reply = respondToAsk(action, stakeholderResponses);
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

  console.log(`Wrote raw log to ${rawLogPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
