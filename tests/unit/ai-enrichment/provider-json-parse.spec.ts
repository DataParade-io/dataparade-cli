import {
  extractBalancedJsonObject,
  parseProviderJsonContent,
  stripJsonFences,
} from "../../../src/ai-enrichment/providers/provider-json-parse";

describe("provider-json-parse", () => {
  it("stripJsonFences removes markdown fence", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extractBalancedJsonObject respects strings and nesting", () => {
    const inner = '{"k":"}"}';
    const full = `  ${inner} trailing junk`;
    const start = full.indexOf("{");
    expect(extractBalancedJsonObject(full, start)).toBe(inner);
  });

  it("parseProviderJsonContent parses trailing non-JSON after object", () => {
    const r = parseProviderJsonContent('{"proposals":[]}\n\nextra');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ proposals: [] });
  });

  it("parseProviderJsonContent fails cleanly on truncated object", () => {
    const r = parseProviderJsonContent('{"proposals":[{"k":');
    expect(r.ok).toBe(false);
  });
});
