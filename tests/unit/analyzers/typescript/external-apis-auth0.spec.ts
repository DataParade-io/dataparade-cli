import type { FileInfo } from "../../../../src/core/types/file";
import { detectExternalApiCalls } from "../../../../src/analyzers/typescript/third-party-detection";
import { buildCodeModel } from "../../../../src/analyzers/typescript/parser";

describe("TS external API detection - URL host patterns", () => {
  it("infers serviceName 'auth0' from axios calls to Auth0 URLs", () => {
    const content = `
      import axios from "axios";

      async function exchangeCode(code: string) {
        return axios.post("https://example-tenant.auth0.com/oauth/token", { code });
      }
    `;

    const file: FileInfo = {
      path: "src/auth/auth0-example.ts",
      name: "auth0-example.ts",
      language: "typescript",
      size: content.length,
      content,
    };

    const model = buildCodeModel(file);
    const findings = detectExternalApiCalls(file, model);

    const auth0Finding = findings.find(
      (f) => f.pattern === "external_api_call" && f.properties?.serviceName === "auth0",
    );

    expect(auth0Finding).toBeDefined();
    expect(auth0Finding?.properties?.url).toBe(
      "https://example-tenant.auth0.com/oauth/token",
    );
  });

  it("infers serviceName 'sendgrid' from fetch calls to SendGrid API URLs", () => {
    const content = `
      fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { "Authorization": "Bearer " + process.env.SENDGRID_API_KEY },
        body: JSON.stringify({ personalizations: [], from: {}, content: [] }),
      });
    `;

    const file: FileInfo = {
      path: "src/notify/send-email.mjs",
      name: "send-email.mjs",
      language: "javascript",
      size: content.length,
      content,
    };

    const model = buildCodeModel(file);
    const findings = detectExternalApiCalls(file, model);

    const sendgridFinding = findings.find(
      (f) =>
        f.pattern === "external_api_call" &&
        f.properties?.serviceName === "sendgrid",
    );

    expect(sendgridFinding).toBeDefined();
    expect(sendgridFinding?.properties?.url).toBe(
      "https://api.sendgrid.com/v3/mail/send",
    );
  });
});


