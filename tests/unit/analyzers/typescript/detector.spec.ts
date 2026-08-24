import type { FileInfo } from "../../../../src/core/types/file";
import { detectPatterns } from "../../../../src/analyzers/typescript/detector";
import * as patternConfig from "../../../../src/analyzers/typescript/typescript-detection-config";

describe("analyzers/typescript/detector - DP-P0-CLI-104", () => {
  function makeFile(content: string, overrides: Partial<FileInfo> = {}): FileInfo {
    return {
      path: overrides.path ?? "src/example.ts",
      name: overrides.name ?? "example.ts",
      content,
      language: overrides.language ?? "typescript",
      size: overrides.size ?? content.length,
    };
  }

  it("detects express-style routes as express_route findings", () => {
    const file = makeFile(
      `
        import express from "express";
        const app = express();

        app.get("/users", (req, res) => {
          res.send("ok");
        });
      `,
    );

    const findings = detectPatterns(file);
    const routeFindings = findings.filter((f) => f.pattern === "express_route");

    expect(routeFindings.length).toBeGreaterThan(0);
    const first = routeFindings[0];
    expect(first.name).toContain("/users");
    expect(first.properties.framework).toBe("express");
  });

  it("detects database client creation as database_connection findings", () => {
    const file = makeFile(
      `
        import { Pool } from "pg";

        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
        });
      `,
    );

    const findings = detectPatterns(file);
    const dbFindings = findings.filter((f) => f.pattern === "database_connection");

    expect(dbFindings.length).toBeGreaterThan(0);
    const first = dbFindings[0];
    expect(first.properties.client).toBe("pg");
    expect(first.properties.databaseType).toBe("postgres");
  });

  it("does not misclassify supabase createClient as redis database_connection", () => {
    const file = makeFile(
      `
        import { createClient } from "@supabase/supabase-js";
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
      `,
      { path: "scripts/supabase-task.mjs", name: "supabase-task.mjs", language: "javascript" },
    );

    const findings = detectPatterns(file);
    const redisFindings = findings.filter(
      (f) =>
        f.pattern === "database_connection" &&
        String(f.properties?.client ?? "").toLowerCase() === "redis",
    );
    expect(redisFindings).toHaveLength(0);

    const supabaseFindings = findings.filter(
      (f) =>
        f.pattern === "database_connection" &&
        String(f.properties?.client ?? "").toLowerCase() === "supabase",
    );
    expect(supabaseFindings.length).toBeGreaterThan(0);
  });

  it("does not report sql_query_detected when file has no DB client import (avoids false positives from update/select/delete in UI)", () => {
    const file = makeFile(
      `
        import { updateAsset } from "@/lib/api/assets";
        export function Form() {
          const [selected, setSelected] = useState(null);
          return <Select value={selected} onUpdate={setSelected} />;
        }
      `,
      { path: "app/components/CreateAssetModal.tsx" },
    );

    const findings = detectPatterns(file);
    const sqlFindings = findings.filter(
      (f) => f.pattern === "database_connection" && f.name === "sql_query_detected",
    );

    expect(sqlFindings).toHaveLength(0);
  });

  it("reports sql_query_detected only when file uses a DB client and content has SQL keywords", () => {
    const file = makeFile(
      `
        import { Pool } from "pg";
        const query = "SELECT * FROM users WHERE id = $1";
        const pool = new Pool();
      `,
    );

    const findings = detectPatterns(file);
    const sqlFindings = findings.filter(
      (f) => f.pattern === "database_connection" && f.name === "sql_query_detected",
    );

    expect(sqlFindings.length).toBe(1);
    expect(sqlFindings[0].properties?.hint).toBe("raw_sql_keyword");
  });

  it("detects external API calls as external_api_call findings", () => {
    const file = makeFile(
      `
        async function callApi() {
          const res = await fetch("https://api.example.com/users");
          return res.json();
        }
      `,
    );

    const findings = detectPatterns(file);
    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");

    expect(apiFindings.length).toBeGreaterThan(0);
    const first = apiFindings[0];
    expect(first.properties.url).toBe("https://api.example.com/users");
  });

  it("ignores localhost templated URLs for external_api_call detection", () => {
    const file = makeFile(
      `
        const port = process.env.PORT || "3000";
        logger.log(\`Application is running on: http://localhost:\${port}\`);
      `,
    );

    const findings = detectPatterns(file);
    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");

    expect(apiFindings).toHaveLength(0);
  });

  it("ignores comment-only URL examples for external_api_call detection", () => {
    const file = makeFile(
      `
        // Example: curl https://api.vendor/v1/resource
        /* See also https://api.vendor/docs */
        export const noop = true;
      `,
    );

    const findings = detectPatterns(file);
    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");

    expect(apiFindings).toHaveLength(0);
  });

  it("detects url: \"https://...\" in object literals and sets serviceName from hostname (no YAML url list)", () => {
    const file = makeFile(
      `
        request.post(
          {
            url: "https://vectorizer.ai/api/v1/vectorize",
            formData: {},
          },
          function () {},
        );
      `,
      { path: "services/vectorize.js", name: "vectorize.js", language: "javascript" },
    );

    const findings = detectPatterns(file);
    const hits = findings.filter(
      (f) =>
        f.pattern === "external_api_call" &&
        String(f.properties?.url ?? "").includes("vectorizer.ai"),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].properties?.serviceName).toBe("vectorizer.ai");
  });

  it("detects auth-related middleware as auth_middleware findings", () => {
    const file = makeFile(
      `
        import passport from "passport";

        app.get(
          "/profile",
          passport.authenticate("jwt", { session: false }),
          (req, res) => res.send("ok"),
        );
      `,
    );

    const findings = detectPatterns(file);
    const authFindings = findings.filter((f) => f.pattern === "auth_middleware");

    expect(authFindings.length).toBeGreaterThan(0);
    const first = authFindings[0];
    expect(first.properties.library).toBe("passport");
  });

  it("detects env variable usage as env_variable findings", () => {
    const file = makeFile(
      `
        const dbUrl = process.env.DATABASE_URL;
        const apiKey = process.env.API_KEY;
      `,
    );

    const findings = detectPatterns(file);
    const envFindings = findings.filter((f) => f.pattern === "env_variable");

    expect(envFindings.length).toBeGreaterThanOrEqual(2);
    const keys = envFindings.map((f) => f.properties.key);
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("API_KEY");
  });

  it("respects config_keys from YAML-driven config for config.<field> detection", () => {
    const originalLoader = patternConfig.loadTypeScriptPatternConfig;

    jest
      .spyOn(patternConfig, "loadTypeScriptPatternConfig")
      .mockImplementation(() => {
        const base = originalLoader();
        return {
          ...base,
          configKeys: {
            keys: [
              ...base.configKeys.keys,
              {
                name: "customKey",
                patternId: "config_file",
                confidence: 0.9,
              },
            ],
          },
        };
      });

    const file: FileInfo = {
      path: "src/config.ts",
      name: "config.ts",
      content: `
        const value = config.customKey;
      `,
      language: "typescript",
      size: 0,
    };

    const findings = detectPatterns(file);
    const configFindings = findings.filter(
      (f) => f.pattern === "config_file" && f.name === "config.customKey",
    );

    expect(configFindings.length).toBeGreaterThan(0);

    (patternConfig.loadTypeScriptPatternConfig as jest.Mock).mockRestore();
  });

  it("detects AWS Lambda handlers as lambda_handler findings", () => {
    const file = makeFile(
      `
        import type { APIGatewayProxyHandler } from "aws-lambda";

        export const handler: APIGatewayProxyHandler = async () => ({
          statusCode: 200,
          body: "ok",
        });
      `,
    );

    const findings = detectPatterns(file);
    const handlers = findings.filter((f) => f.pattern === "lambda_handler");

    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers[0].properties.framework).toBe("aws_lambda");
    expect(handlers[0].properties.handlerType).toBe("serverless_handler");
  });

  it("detects GCP Cloud Functions handlers as lambda_handler findings", () => {
    const file = makeFile(
      `
        import * as functions from "@google-cloud/functions-framework";

        functions.http("helloHttp", (req, res) => {
          res.send("ok");
        });
      `,
    );

    const findings = detectPatterns(file);
    const handlers = findings.filter((f) => f.pattern === "lambda_handler");

    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers[0].properties.framework).toBe("gcp_functions");
    expect(handlers[0].properties.handlerType).toBe("serverless_handler");
  });

  it("detects gRPC client dial as external_api_call findings", () => {
    const file = makeFile(
      `
        import * as grpc from "@grpc/grpc-js";

        const client = new GreeterClient(
          "localhost:50051",
          grpc.credentials.createInsecure(),
        );
      `,
    );

    const findings = detectPatterns(file);
    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");

    expect(apiFindings.length).toBeGreaterThan(0);
    expect(apiFindings.some((f) => f.properties.client === "grpc")).toBe(true);
  });

  it("detects OAuth2 libraries as auth_middleware findings", () => {
    const file = makeFile(
      `
        import { OAuth2Client } from "google-auth-library";

        const client = new OAuth2Client();
      `,
    );

    const findings = detectPatterns(file);
    const authFindings = findings.filter((f) => f.pattern === "auth_middleware");

    expect(authFindings.length).toBeGreaterThan(0);
    expect(authFindings.some((f) => f.properties.strategy === "oauth2")).toBe(
      true,
    );
  });

  it("detects dotenv.config as config_file findings", () => {
    const file = makeFile(
      `
        import dotenv from "dotenv";
        dotenv.config();
      `,
    );

    const findings = detectPatterns(file);
    const configFindings = findings.filter(
      (f) => f.pattern === "config_file" && f.name === "dotenv_config",
    );

    expect(configFindings.length).toBeGreaterThan(0);
  });

  it("still detects Express routes after a template literal that contains //", () => {
    const file = makeFile(
      `
        import express from "express";
        const app = express();
        const docs = \`See http://example.com/guide\`;
        app.get("/users", (_req, res) => res.send("ok"));
      `,
    );

    const findings = detectPatterns(file);
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0].name).toContain("/users");
  });

  it("detects gRPC service registration as express_route findings", () => {
    const file = makeFile(
      `
        import * as grpc from "@grpc/grpc-js";

        const server = new grpc.Server();
        server.addService(serviceDefinition, implementation);
      `,
    );

    const findings = detectPatterns(file);
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.length).toBeGreaterThan(0);
    expect(routes.some((f) => f.properties.framework === "grpc")).toBe(true);
  });

  it("detects Bearer authorization headers as auth_middleware findings", () => {
    const file = makeFile(
      `
        const headers = { Authorization: "Bearer token-value" };
      `,
    );

    const findings = detectPatterns(file);
    const authFindings = findings.filter((f) => f.pattern === "auth_middleware");

    expect(authFindings.length).toBeGreaterThan(0);
    expect(authFindings.some((f) => f.properties.strategy === "bearer_token")).toBe(
      true,
    );
  });

  it("detects jsonwebtoken import with strategy jwt", () => {
    const file = makeFile(
      `
        import jwt from "jsonwebtoken";
        const token = jwt.sign({ userId: 1 }, process.env.JWT_SECRET);
      `,
    );
    const findings = detectPatterns(file);
    const authFindings = findings.filter((f) => f.pattern === "auth_middleware");
    expect(authFindings.length).toBeGreaterThan(0);
    expect(authFindings.some((f) => f.properties.strategy === "jwt")).toBe(true);
  });

  it("detects better-sqlite3 as database_connection with databaseType sqlite", () => {
    const file = makeFile(
      `
        import Database from "better-sqlite3";
        const db = new Database("app.db");
      `,
    );
    const findings = detectPatterns(file);
    const dbFindings = findings.filter((f) => f.pattern === "database_connection");
    expect(dbFindings.length).toBeGreaterThan(0);
    expect(dbFindings.some((f) => f.properties.databaseType === "sqlite")).toBe(true);
  });

  it("detects cassandra-driver as database_connection with databaseType cassandra", () => {
    const file = makeFile(
      `
        import { Client } from "cassandra-driver";
        const client = new Client({ contactPoints: ["localhost"] });
      `,
    );
    const findings = detectPatterns(file);
    const dbFindings = findings.filter((f) => f.pattern === "database_connection");
    expect(dbFindings.length).toBeGreaterThan(0);
    expect(dbFindings.some((f) => f.properties.databaseType === "cassandra")).toBe(true);
  });

  it("detects mssql as database_connection with databaseType mssql", () => {
    const file = makeFile(
      `
        import sql from "mssql";
        await sql.connect(config);
      `,
    );
    const findings = detectPatterns(file);
    const dbFindings = findings.filter((f) => f.pattern === "database_connection");
    expect(dbFindings.length).toBeGreaterThan(0);
    expect(dbFindings.some((f) => f.properties.databaseType === "mssql")).toBe(true);
  });

  it("detects @aws-sdk/client-dynamodb as database_connection with databaseType dynamodb", () => {
    const file = makeFile(
      `
        import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
        const client = new DynamoDBClient({ region: "us-east-1" });
      `,
    );
    const findings = detectPatterns(file);
    const dbFindings = findings.filter((f) => f.pattern === "database_connection");
    expect(dbFindings.length).toBeGreaterThan(0);
    expect(dbFindings.some((f) => f.properties.databaseType === "dynamodb")).toBe(true);
  });

  it("detects axios as external_api_call findings", () => {
    const file = makeFile(
      `
        import axios from "axios";
        const res = await axios.get("https://api.example.com/users");
      `,
    );
    const findings = detectPatterns(file);
    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");
    expect(apiFindings.length).toBeGreaterThan(0);
    expect(apiFindings.some((f) => f.properties.client === "axios")).toBe(true);
  });

  it("detects node-fetch as external_api_call findings", () => {
    const file = makeFile(
      `
        import fetch from "node-fetch";
        const res = await fetch("https://api.example.com/data");
      `,
    );
    const findings = detectPatterns(file);
    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");
    expect(apiFindings.length).toBeGreaterThan(0);
    expect(apiFindings.some((f) => f.properties.client === "fetch")).toBe(true);
  });

  it("detects important env variable keys from the importantKeys list", () => {
    const file = makeFile(
      `
        const secret = process.env.JWT_SECRET;
        const key = process.env.STRIPE_SECRET_KEY;
      `,
    );
    const findings = detectPatterns(file);
    const envFindings = findings.filter((f) => f.pattern === "env_variable");
    expect(envFindings.length).toBeGreaterThanOrEqual(2);
    const keys = envFindings.map((f) => f.properties.key);
    expect(keys).toContain("JWT_SECRET");
    expect(keys).toContain("STRIPE_SECRET_KEY");
  });

  it("does not match Express routes inside line comments", () => {
    const file = makeFile(
      `
        import express from "express";
        const app = express();
        // app.get("/hidden", (_req, res) => res.send("nope"));
      `,
    );

    const findings = detectPatterns(file);
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes).toHaveLength(0);
  });
});

