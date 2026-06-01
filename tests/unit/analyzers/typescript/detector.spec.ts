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
});

