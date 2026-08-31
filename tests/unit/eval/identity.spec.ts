import type { EvalCase, LayerFinding } from "../../eval/types";
import {
  identitiesMatch,
  labelsMatch,
  tokensCompatible,
  tokenSatisfiesExpected,
} from "../../eval/identity";

function piiCase(key: string, name?: string): EvalCase {
  return {
    id: "case",
    fixture: "fx",
    layer: "pii-signals",
    subject: name ? { key, name } : { key },
    evidence: { file_path: "a.py", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: [] },
    rationale: "synthetic",
  };
}

function finding(key: string, labels: string[]): LayerFinding {
  return {
    key,
    labels,
    sourceFilePaths: ["a.py"],
    sourceLines: [{ file_path: "a.py", start_line: 1, end_line: 1 }],
  };
}

describe("eval identity contract", () => {
  it("keeps component and data-flow keys exact", () => {
    const componentCase: EvalCase = {
      ...piiCase("third_party:checkr"),
      layer: "components",
      subject: { key: "third_party:checkr" },
    };
    expect(
      identitiesMatch(finding("asset:requests call", ["asset"]), componentCase),
    ).toBe(false);
    expect(
      identitiesMatch(finding("third_party:checkr", ["third_party"]), componentCase),
    ).toBe(true);
  });

  it("maps gold pii taxonomy keys onto matcher rule ids", () => {
    expect(
      identitiesMatch(
        finding("pii_signal:email", ["user_email"]),
        piiCase("pii:email_address"),
      ),
    ).toBe(true);
    expect(
      identitiesMatch(
        finding("pii_signal:ssn", ["social_security_number"]),
        piiCase("pii:national_identifier", "social_security_number"),
      ),
    ).toBe(true);
    expect(
      identitiesMatch(
        finding("pii_signal:first_name", ["first_name"]),
        piiCase("pii:person_name", "first_name"),
      ),
    ).toBe(true);
  });

  it("maps gold data-item field names onto matcher rule ids", () => {
    const dataItem: EvalCase = {
      ...piiCase("data_item:social_security_number"),
      layer: "data-items",
      subject: { key: "data_item:social_security_number", name: "social_security_number" },
    };
    expect(identitiesMatch(finding("data_item:ssn", ["social_security_number"]), dataItem)).toBe(
      true,
    );
    expect(identitiesMatch(finding("data_item:email", ["user_email"]), dataItem)).toBe(false);
  });

  it("treats gold taxonomy labels as parents of scanner rule labels", () => {
    expect(tokenSatisfiesExpected("person_name", "first_name")).toBe(true);
    expect(tokenSatisfiesExpected("national_identifier", "social_security_number")).toBe(true);
    expect(tokensCompatible("email_address", "user_email")).toBe(true);

    const personCase: EvalCase = {
      ...piiCase("pii:person_name", "first_name"),
      expected: { status: "positive", labels: ["person_name"] },
    };
    expect(labelsMatch(finding("pii_signal:first_name", ["first_name"]), personCase)).toBe(true);
  });

  it("accepts layer-generic gold labels on a matched finding", () => {
    const flowCase: EvalCase = {
      ...piiCase("flow:a->b"),
      layer: "data-flows",
      subject: { key: "flow:a->b" },
      expected: { status: "positive", labels: ["data_flow"] },
    };
    expect(labelsMatch(finding("flow:a->b", ["api_call"]), flowCase)).toBe(true);
  });
});
