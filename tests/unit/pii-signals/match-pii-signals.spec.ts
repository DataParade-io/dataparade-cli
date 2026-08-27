import {
  matchPiiSignalsInFile,
  matchPiiSignalsInFiles,
  piiSignalIdentity,
} from "../../../src/pii-signals/match-pii-signals";
import { loadPiiSignalRules } from "../../../src/ai-enrichment/pii-signal-rules";

describe("matchPiiSignalsInFile", () => {
  const rules = loadPiiSignalRules();

  it("matches username and password on separate lines", () => {
    const content = [
      "spring:",
      "  datasource:",
      "    username: billing_app",
      "    password: super-secret-value",
    ].join("\n");

    const hits = matchPiiSignalsInFile(
      { filePath: "application.yml", content },
      rules,
    );

    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "username",
          category: "credentials",
          labels: ["username"],
          evidence: {
            filePath: "application.yml",
            startLine: 3,
            endLine: 3,
            reason: "matched pii:username signal",
          },
        }),
        expect.objectContaining({
          id: "password",
          category: "credentials",
          labels: ["user_password"],
          evidence: {
            filePath: "application.yml",
            startLine: 4,
            endLine: 4,
            reason: "matched pii:password signal",
          },
        }),
      ]),
    );
  });

  it("matches email on a parameter declaration", () => {
    const content = "Customer findByEmail(String email);";
    const hits = matchPiiSignalsInFile(
      { filePath: "CustomerRepository.java", content },
      rules,
    );

    expect(hits).toEqual([
      {
        id: "email",
        category: "credentials",
        labels: ["user_email"],
        evidence: {
          filePath: "CustomerRepository.java",
          startLine: 1,
          endLine: 1,
          reason: "matched pii:email signal",
        },
      },
    ]);
  });

  it("does not match passport auth middleware without passport number tokens", () => {
    const content = "passport.authenticate(\"jwt\", { session: false }),";
    const hits = matchPiiSignalsInFile(
      { filePath: "server.ts", content },
      rules,
    );

    expect(hits).toEqual([]);
  });

  it("does not match standalone address on terraform resource attributes", () => {
    const content = "DATABASE_URL = aws_db_instance.main.address";
    const hits = matchPiiSignalsInFile(
      { filePath: "main.tf", content },
      rules,
    );

    expect(hits).toEqual([]);
  });

  it("aggregates hits across files", () => {
    const hits = matchPiiSignalsInFiles(
      [
        { filePath: "a.yml", content: "username: app" },
        { filePath: "b.yml", content: "password: secret" },
      ],
      rules,
    );

    expect(hits.map((hit) => hit.id)).toEqual(["username", "password"]);
  });

  it("formats pii signal identity for eval subjects", () => {
    expect(piiSignalIdentity("email")).toBe("pii_signal:email");
  });
});
