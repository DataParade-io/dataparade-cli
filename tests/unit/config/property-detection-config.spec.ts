import fs from "fs";
import path from "path";

import {
  loadPropertyDetectionConfig,
  clearPropertyDetectionConfigCache,
} from "../../../src/config/property-detection-config";

describe("property-detection-config - inference_rules validation", () => {
  it("throws when inference_rules.set assigns an unsupported property key", () => {
    const invalidYaml = `
regexes: {}
inference_rules:
  env_variable:
    - when:
        always: true
      set:
        not_a_supported_property: true
`;

    clearPropertyDetectionConfigCache();

    const original = fs.readFileSync.bind(fs);
    const spy = jest
      .spyOn(fs, "readFileSync")
      .mockImplementation((filePath: any, encoding?: any) => {
        const p = String(filePath);
        if (p.endsWith(path.join("patterns", "property.patterns.yaml"))) {
          return invalidYaml;
        }
        return original(filePath, encoding);
      });

    try {
      expect(() => loadPropertyDetectionConfig()).toThrow(
        /unknown\/unsupported property key/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

