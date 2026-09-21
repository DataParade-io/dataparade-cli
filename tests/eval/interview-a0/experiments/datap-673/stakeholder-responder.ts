import fs from "fs";
import path from "path";
import YAML from "yaml";

import type { InterviewAction, InterviewSlot } from "../../types";

interface StakeholderMatch {
  slot: InterviewSlot;
  discoveryId?: string;
}

interface StakeholderResponse {
  match: StakeholderMatch;
  stakeholder_text?: string;
  write_value?: string | string[];
  refuse?: boolean;
}

export interface StakeholderReply {
  text: string;
  refuse: boolean;
  suggestedWriteValue?: string | string[];
}

function loadStakeholderScript(scriptPath: string): StakeholderResponse[] {
  const raw = YAML.parse(fs.readFileSync(scriptPath, "utf8")) as {
    responses: StakeholderResponse[];
  };
  return raw.responses;
}

function extractDiscoveryId(action: InterviewAction): string | undefined {
  if (action.discoveryId) {
    return action.discoveryId;
  }
  const haystack = action.text ?? "";
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

export function respondToAsk(
  action: InterviewAction,
  scriptPath = path.join(__dirname, "stakeholder-script.yaml"),
): StakeholderReply {
  const responses = loadStakeholderScript(scriptPath);
  const discoveryId = extractDiscoveryId(action);
  const match = responses.find((entry) => {
    if (entry.match.slot !== action.slot) {
      return false;
    }
    if (entry.match.discoveryId && entry.match.discoveryId !== discoveryId) {
      return false;
    }
    if (!entry.match.discoveryId && discoveryId) {
      return false;
    }
    return true;
  });

  if (!match) {
    throw new Error(
      `No scripted stakeholder response for ask slot=${action.slot} discoveryId=${action.discoveryId ?? "(none)"}`,
    );
  }

  return {
    text: match.stakeholder_text ?? String(match.write_value ?? ""),
    refuse: Boolean(match.refuse),
    suggestedWriteValue: match.write_value,
  };
}
