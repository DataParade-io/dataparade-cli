import fs from "fs";
import path from "path";

import { extractActionLinesFromContent, mapRawLogToActions } from "./map-raw-to-actions";

const experimentDir = __dirname;
const rawLogPath = path.join(experimentDir, "raw-model-transcript.jsonl");

describe("DATAP-673 map-raw-to-actions", () => {
  it("extracts ACTION_JSON lines from assistant content without hand-editing", () => {
    const sample =
      'ACTION_JSON:{"kind":"ask","slot":"system_identity","text":"confirm"}\n' +
      'noise line\nACTION_JSON:{"kind":"done"}';
    const actions = extractActionLinesFromContent(sample);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("ask");
    expect(actions[0].slot).toBe("system_identity");
  });

  it("maps checked-in raw log to interview actions", () => {
    expect(fs.existsSync(rawLogPath)).toBe(true);
    const interview = mapRawLogToActions(rawLogPath);
    expect(interview.actions.length).toBeGreaterThan(0);
    expect(interview.actions.every((a) => ["ask", "write", "refuse"].includes(a.kind))).toBe(
      true,
    );
  });
});
