import fs from "fs";
import path from "path";

import {
  assertResponseModelIsLuna,
  extractActionLinesFromContent,
  mapRawLogToActions,
} from "./map-raw-to-actions";

const experimentDir = __dirname;
const rawLogPath = path.join(experimentDir, "raw-model-transcript.jsonl");

describe("DATAP-691 map-raw-to-actions", () => {
  it("extracts first ACTION_JSON object even with trailing garbage", () => {
    const sample =
      'ACTION_JSON:{"kind":"ask","slot":"system_identity","text":"confirm"} trailing noise';
    const actions = extractActionLinesFromContent(sample);
    expect(actions).toHaveLength(1);
    expect(actions[0].slot).toBe("system_identity");
  });

  it("maps checked-in raw log and verifies gpt-5.6-luna in responses", () => {
    expect(fs.existsSync(rawLogPath)).toBe(true);
    assertResponseModelIsLuna(rawLogPath);
    const interview = mapRawLogToActions(rawLogPath);
    expect(interview.actions.length).toBeGreaterThan(0);
  });
});
