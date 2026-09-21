#!/usr/bin/env node
/**
 * DATAP-693: live OpenAI interview run with gpt-5.6-luna (skill pin f8b4f28).
 * Writes unedited API log to raw-model-transcript.jsonl.
 * Usage: OPENAI_API_KEY=... node run-model-interview.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "../../fixtures/dpkb");
const rawLogPath = path.join(__dirname, "raw-model-transcript.jsonl");
const REQUIRED_MODEL = "gpt-5.6-luna";
const REQUIRED_SKILL_SHA = "f8b4f2810f0be856f9bf5421af5ea0db51ecd768";
const REQUIRED_BRIEF_SHA = "16f2e857a47d54bfea6ca5d7f23a6c4f2732da29";
const REQUIRED_ONTOLOGY_SHA = "0656c5d9a6ce0d31440c63327ce597ce8df4414f";
const model = process.env.DATAP_693_MODEL ?? REQUIRED_MODEL;
const maxTurns = Number(process.env.DATAP_693_MAX_TURNS ?? "120");

if (model !== REQUIRED_MODEL) {
  throw new Error(`DATAP-693 requires model id ${REQUIRED_MODEL}, got ${model}`);
}

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

function normalizeSlot(slot) {
  if (slot === "actor" || slot === "actor_kind") return "actors";
  if (slot === "external_system") return "external_systems";
  if (/^flow_\d+\.data_categories$/.test(slot)) return "sends_data_to.data_categories";
  if (/^flow_\d+\.purpose$/.test(slot)) return "sends_data_to.purpose";
  return slot;
}

const SCAN_KNOWN_REDIRECTS = {
  external_systems:
    "ExternalSystems are partial known from scan. Do not re-ask canonical names or merge duplicate ids. Continue with unknown flow data_categories and purpose.",
  "sends_data_to.endpoint":
    "Flow endpoints are scan-known in the brief. Ask only data_categories and purpose per flow_*.",
};

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
  const slot = normalizeSlot(action.slot);
  const discoveryId = extractDiscoveryId({ ...action, slot });
  const match = responses.find((entry) => {
    if (entry.match.slot !== slot) return false;
    if (entry.match.discoveryId && entry.match.discoveryId !== discoveryId) return false;
    if (!entry.match.discoveryId && discoveryId) return false;
    return true;
  });
  if (!match) {
    if (SCAN_KNOWN_REDIRECTS[slot]) {
      return { text: SCAN_KNOWN_REDIRECTS[slot], refuse: false };
    }
    if (slot.startsWith("sends_data_to.") && !discoveryId) {
      return {
        text:
          "Please ask per flow_* id from the brief (data_categories and purpose are per flow, not per cmp).",
        refuse: false,
      };
    }
    if (discoveryId?.startsWith("flow_")) {
      return {
        text: `For ${discoveryId}, use slots sends_data_to.data_categories and sends_data_to.purpose separately.`,
        refuse: false,
      };
    }
    throw new Error(
      `No scripted stakeholder response for ${slot} ${discoveryId ?? ""}`,
    );
  }
  return {
    text: match.stakeholder_text ?? String(match.write_value ?? ""),
    refuse: Boolean(match.refuse),
  };
}

function extractFirstActionObject(content) {
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
        return JSON.parse(content.slice(i, j + 1));
      }
    }
  }
  return null;
}

function parseActionLines(content) {
  const raw = extractFirstActionObject(content);
  if (!raw) return [];
  if (raw.kind === "done") return [];
  return [raw];
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
  const responseModel = payload.model ?? "";
  if (!responseModel.includes(REQUIRED_MODEL)) {
    throw new Error(
      `Response model must include ${REQUIRED_MODEL}; got ${responseModel || "(missing)"}`,
    );
  }

  appendLog({
    type: "api_response",
    timestamp: new Date().toISOString(),
    id: payload.id,
    model: responseModel,
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
    ticket: "DATAP-693",
    model,
    requiredModel: REQUIRED_MODEL,
    briefSha: REQUIRED_BRIEF_SHA,
    skillSha: REQUIRED_SKILL_SHA,
    ontologyVersion: "0.2.0",
    ontologySha: REQUIRED_ONTOLOGY_SHA,
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

  console.log(`Wrote raw log to ${rawLogPath} (model ${REQUIRED_MODEL})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
