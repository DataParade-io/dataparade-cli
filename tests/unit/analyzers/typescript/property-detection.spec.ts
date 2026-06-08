import type { RawFinding } from "../../../../src/core/types/detection";
import { getPropertiesFromFinding } from "../../../../src/analyzers/shared/property-inference";

function makeFinding(
  overrides: Partial<RawFinding> & Pick<RawFinding, "pattern" | "name">,
): RawFinding {
  return {
    pattern: overrides.pattern,
    name: overrides.name,
    confidence: overrides.confidence ?? 0.9,
    location: overrides.location ?? {
      filePath: "src/example.ts",
      startLine: 1,
      endLine: 1,
    },
    properties: overrides.properties ?? {},
  };
}

describe("property-detection", () => {
  describe("auth_middleware", () => {
    it("sets mfa_required and authentication_method when strategy matches MFA", () => {
      const finding = makeFinding({
        pattern: "auth_middleware",
        name: "passport:mfa",
        properties: { library: "passport", strategy: "mfa" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.mfa_required).toBe(true);
      expect(out.authentication_method).toBe("mfa");
      expect(out.audit_logging_enabled).toBe(true);
    });

    it("sets mfa_required when file content contains webauthn", () => {
      const finding = makeFinding({
        pattern: "auth_middleware",
        name: "auth",
        properties: { library: "passport" },
      });
      const content = "import { authenticate } from 'webauthn';";
      const out = getPropertiesFromFinding(finding, content);
      expect(out.mfa_required).toBe(true);
      expect(out.authentication_method).toBe("mfa");
    });

    it("sets authentication_method jwt for jsonwebtoken library", () => {
      const finding = makeFinding({
        pattern: "auth_middleware",
        name: "jwt",
        properties: { library: "jsonwebtoken" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.authentication_method).toBe("jwt");
      expect(out.audit_logging_enabled).toBe(true);
    });

    it("sets authentication_method oauth_2_0 for oauth strategy", () => {
      const finding = makeFinding({
        pattern: "auth_middleware",
        name: "passport:oauth",
        properties: { library: "passport", strategy: "oauth" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.authentication_method).toBe("oauth_2_0");
    });
  });

  describe("env_variable", () => {
    it("sets cloud_provider from AWS env keys", () => {
      const finding = makeFinding({
        pattern: "env_variable",
        name: "process.env.AWS_REGION",
        properties: { key: "AWS_REGION" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.cloud_provider).toBe("AWS");
    });

    it("sets encrypt_at_rest for ENCRYPTION_KEY", () => {
      const finding = makeFinding({
        pattern: "env_variable",
        name: "process.env.ENCRYPTION_KEY",
        properties: { key: "ENCRYPTION_KEY" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.encrypt_at_rest).toBe("aes_256");
    });

    it("sets connection_encryption for DATABASE_URL", () => {
      const finding = makeFinding({
        pattern: "env_variable",
        name: "process.env.DATABASE_URL",
        properties: { key: "DATABASE_URL" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.connection_encryption).toBe(true);
    });
  });

  describe("config_file", () => {
    it("sets audit_logging_enabled for audit config key", () => {
      const finding = makeFinding({
        pattern: "config_file",
        name: "config.audit",
        properties: { key: "audit" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.audit_logging_enabled).toBe(true);
    });
  });

  describe("database_connection", () => {
    it("sets connection_encryption when content has ssl: true", () => {
      const finding = makeFinding({
        pattern: "database_connection",
        name: "pg",
        properties: { databaseType: "postgres" },
      });
      const content = "new Pool({ ssl: true });";
      const out = getPropertiesFromFinding(finding, content);
      expect(out.connection_encryption).toBe(true);
      expect(out.audit_logging_enabled).toBe(true);
    });
  });

  describe("external_api_call", () => {
    it("sets integration_method and authentication_method", () => {
      const finding = makeFinding({
        pattern: "external_api_call",
        name: "Stripe",
        properties: { serviceName: "stripe" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.integration_method).toBe("api");
      expect(out.authentication_method).toBe("api_key");
    });

    it("sets api_type graphql when url path is GraphQL", () => {
      const finding = makeFinding({
        pattern: "external_api_call",
        name: "Graph API",
        properties: {
          serviceName: "internal",
          url: "https://api.example.com/graphql",
        },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.api_type).toBe("graphql");
    });
  });

  describe("express_route", () => {
    it("sets request_validation and connection_encryption", () => {
      const finding = makeFinding({
        pattern: "express_route",
        name: "GET /api",
        properties: { httpMethods: ["GET"], path: "/api" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.request_validation).toBe(true);
      expect(out.connection_encryption).toBe(true);
      expect(out.api_type).toBe("rest");
    });

    it("sets api_type graphql for GraphQL route path", () => {
      const finding = makeFinding({
        pattern: "express_route",
        name: "POST /graphql",
        properties: { httpMethods: ["POST"], path: "/graphql" },
      });
      const out = getPropertiesFromFinding(finding);
      expect(out.api_type).toBe("graphql");
    });
  });
});
