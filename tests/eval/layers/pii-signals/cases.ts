import type { EvalCase } from "../../types";

/** Ground-truth PII signal cases from committed fixtures (5–6 mixed outcomes). */
export const piiSignalEvalCases: EvalCase[] = [
  {
    id: "jvm-yaml-datasource-username",
    fixture: "jvm-manifests-basic",
    layer: "pii-signals",
    subject: { key: "pii_signal:username", name: "username" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 6,
      end_line: 6,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Spring datasource username property is a credentials-category username signal.",
  },
  {
    id: "jvm-yaml-datasource-password",
    fixture: "jvm-manifests-basic",
    layer: "pii-signals",
    subject: { key: "pii_signal:password", name: "password" },
    evidence: {
      file_path: "src/main/resources/application.yml",
      start_line: 7,
      end_line: 7,
    },
    expected: { status: "positive", labels: ["user_password"] },
    rationale:
      "Spring datasource password property is a credentials-category password signal.",
  },
  {
    id: "java-repository-email-parameter",
    fixture: "java-basic",
    layer: "pii-signals",
    subject: { key: "pii_signal:email", name: "email" },
    evidence: {
      file_path: "src/main/java/com/acme/billing/data/CustomerRepository.java",
      start_line: 9,
      end_line: 9,
    },
    expected: { status: "positive", labels: ["user_email"] },
    rationale:
      "Repository method parameter named email matches the email credentials signal.",
  },
  {
    id: "dotnet-connection-string-username",
    fixture: "dotnet-manifests-basic",
    layer: "pii-signals",
    subject: { key: "pii_signal:username", name: "username" },
    evidence: {
      file_path: "src/Api/appsettings.json",
      start_line: 8,
      end_line: 8,
    },
    expected: { status: "positive", labels: ["username"] },
    rationale:
      "Connection string Username token in appsettings.json matches the username signal.",
  },
  {
    id: "tf-db-instance-address-not-profile-address",
    fixture: "terraform-basic",
    layer: "pii-signals",
    subject: { key: "pii_signal:address", name: "address" },
    evidence: { file_path: "main.tf", start_line: 29, end_line: 29 },
    expected: { status: "negative", labels: [] },
    rationale:
      "aws_db_instance.main.address is a Terraform hostname attribute, not a postal-address profile signal.",
  },
  {
    id: "ts-passport-auth-not-passport-number",
    fixture: "typescript-basic",
    layer: "pii-signals",
    subject: { key: "pii_signal:passport", name: "passport" },
    evidence: { file_path: "server.ts", start_line: 23, end_line: 23 },
    expected: { status: "negative", labels: [] },
    rationale:
      "passport.authenticate is local JWT middleware, not a passport-number identifier signal.",
  },
];
