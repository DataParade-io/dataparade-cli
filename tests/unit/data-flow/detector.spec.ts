import type { DetectedComponent } from "../../../src/core/types/component";
import type { RawFinding } from "../../../src/core/types/detection";
import type { FileInfo } from "../../../src/core/types/file";
import { detectDataFlows } from "../../../src/data-flow/detect";

function makeLocation(overrides?: Partial<RawFinding["location"]>) {
  return {
    filePath: overrides?.filePath ?? "src/example.ts",
    startLine: overrides?.startLine ?? 1,
    endLine: overrides?.endLine ?? 1,
    code: overrides?.code,
  };
}

function makeFinding(
  overrides: Partial<RawFinding> & Pick<RawFinding, "pattern" | "name">,
): RawFinding {
  return {
    pattern: overrides.pattern,
    name: overrides.name,
    confidence: overrides.confidence ?? 0.9,
    location: overrides.location ?? makeLocation({}),
    properties: overrides.properties ?? {},
    description: overrides.description,
  };
}

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    subType: overrides.subType,
    confidence: overrides.confidence ?? 0.9,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
    description: overrides.description,
    dataFlowIds: overrides.dataFlowIds,
  };
}

const emptyFiles: FileInfo[] = [];

describe("data-flow/detector - DP-P0-CLI-301", () => {
  describe("source resolution", () => {
    it("returns empty flows when no source component (no assets)", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: {},
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "stripe",
          properties: { serviceName: "stripe" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(0);
    });

    it("uses asset with isMainApplication as source", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Application",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "cmp_2",
          name: "PostgreSQL",
          type: "asset",
          subType: "database",
          properties: { databaseType: "postgresql" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "pg",
          properties: { client: "pg", databaseType: "postgresql" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("cmp_1");
      expect(flows[0].targetComponentId).toBe("cmp_2");
      expect(flows[0].type).toBe("database_query");
    });

    it("falls back to first api/service asset when no isMainApplication", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "cmp_1",
          name: "Backend API",
          type: "asset",
          subType: "api",
          properties: {},
        }),
        makeComponent({
          id: "cmp_2",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: { serviceName: "stripe" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "stripe",
          properties: { serviceName: "stripe" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("cmp_1");
      expect(flows[0].targetComponentId).toBe("cmp_2");
    });

    it("uses isMainApplication source matching finding section_id", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app_s1",
          name: "App S1",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, section_id: "s1" },
        }),
        makeComponent({
          id: "app_s2",
          name: "App S2",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, section_id: "s2" },
        }),
        makeComponent({
          id: "db_s2",
          name: "PostgreSQL",
          type: "asset",
          subType: "database",
          properties: { databaseType: "postgresql", section_id: "s2" },
        }),
      ];

      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "pg",
          properties: {
            client: "pg",
            databaseType: "postgresql",
            section_id: "s2",
          },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].type).toBe("database_query");
      expect(flows[0].sourceComponentId).toBe("app_s2");
      expect(flows[0].targetComponentId).toBe("db_s2");
    });
  });

  describe("database flows", () => {
    it("produces database_query flow from database_connection finding to matching asset", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "Application",
          type: "asset",
          subType: "service",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "db",
          name: "PostgreSQL",
          type: "asset",
          subType: "database",
          properties: { databaseType: "postgresql" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "Primary Postgres",
          location: makeLocation({ filePath: "src/db.ts", startLine: 10, endLine: 12 }),
          properties: { client: "pg", databaseType: "postgresql" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].type).toBe("database_query");
      expect(flows[0].sourceComponentId).toBe("app");
      expect(flows[0].targetComponentId).toBe("db");
      expect(flows[0].sourceLocation).toEqual({
        filePath: "src/db.ts",
        startLine: 10,
        endLine: 12,
      });
    });

    it("matches database component by databaseType when names differ", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "redis",
          name: "Redis Cache",
          type: "asset",
          subType: "database",
          properties: { databaseType: "redis" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "redis-client",
          properties: { databaseType: "redis", client: "ioredis" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].targetComponentId).toBe("redis");
      expect(flows[0].type).toBe("database_query");
      expect(flows[0].targetScope).toBe("unknown");
      expect(flows[0].targetScopeConfidence).toBe("low");
    });
  });

  describe("external API / third-party flows", () => {
    it("produces api_call flow from external_api_call finding to matching third_party", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "Application",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "tp",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: { serviceName: "stripe" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "StripeClient",
          properties: { serviceName: "stripe", client: "stripe" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].type).toBe("api_call");
      expect(flows[0].sourceComponentId).toBe("app");
      expect(flows[0].targetComponentId).toBe("tp");
      expect(flows[0].targetScope).toBe("external");
      expect(flows[0].targetScopeConfidence).toBe("high");
      expect(flows[0].targetScopeReason).toBe("third-party-target");
    });

    it("matches third_party by literal url when serviceName is absent on finding", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "HTTP API",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, framework: "express" },
        }),
        makeComponent({
          id: "tp_clip",
          name: "Clipdrop",
          type: "third_party",
          subType: "ai_provider",
          properties: {
            serviceName: "clipdrop",
            url: "https://clipdrop-api.co/remove-background/v1",
          },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "https://clipdrop-api.co/remove-background/v1",
          properties: {
            client: "fetch",
            url: "https://clipdrop-api.co/remove-background/v1",
          },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("app");
      expect(flows[0].targetComponentId).toBe("tp_clip");
    });

    it("attributes external_api_call to Express API route when handler module is imported from route file", () => {
      const devServer = `import express from 'express';
import aiCompletionHandler from './api/ai-completion.js';
const app = express();
app.post('/api/ai-completion', (req, res) => {
  aiCompletionHandler(req, res);
});
`;
      const handler = `import OpenAI from 'openai';
export default async function handler() {
  const client = new OpenAI();
  await client.chat.completions.create({});
}
`;
      const files: FileInfo[] = [
        {
          path: "srv/dev-server.js",
          name: "dev-server.js",
          content: devServer,
          language: "javascript",
          size: devServer.length,
        },
        {
          path: "srv/api/ai-completion.js",
          name: "ai-completion.js",
          content: handler,
          language: "javascript",
          size: handler.length,
        },
      ];
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "project",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "route_ai",
          name: "Post /api/ai Completion",
          type: "asset",
          subType: "api",
          properties: { path: "/api/ai-completion", framework: "express" },
          sourceLocations: [
            {
              filePath: "srv/dev-server.js",
              startLine: 4,
              endLine: 4,
              code: "app.post('/api/ai-completion'",
            },
          ],
        }),
        makeComponent({
          id: "tp_openai",
          name: "Openai",
          type: "third_party",
          subType: "ai_provider",
          properties: { serviceName: "openai", client: "openai" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "openai",
          location: makeLocation({
            filePath: "srv/api/ai-completion.js",
            startLine: 4,
            endLine: 4,
          }),
          properties: { serviceName: "openai", client: "openai" },
        }),
      ];
      const flows = detectDataFlows(files, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("route_ai");
      expect(flows[0].targetComponentId).toBe("tp_openai");
    });

    it("attributes external_api_call to containing route when call is in same file as route registration", () => {
      const server = `import express from 'express';
const app = express();
app.get('/health', (req, res) => res.send('ok'));
app.post('/data', (req, res) => {
  void fetch('https://api.stripe.com/v1/charges');
});
`;
      const files: FileInfo[] = [
        {
          path: "src/server.ts",
          name: "server.ts",
          content: server,
          language: "typescript",
          size: server.length,
        },
      ];
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "route_health",
          name: "GET /health",
          type: "asset",
          subType: "api",
          properties: { path: "/health" },
          sourceLocations: [
            { filePath: "src/server.ts", startLine: 3, endLine: 3 },
          ],
        }),
        makeComponent({
          id: "route_data",
          name: "POST /data",
          type: "asset",
          subType: "api",
          properties: { path: "/data" },
          sourceLocations: [
            { filePath: "src/server.ts", startLine: 4, endLine: 4 },
          ],
        }),
        makeComponent({
          id: "tp",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: { serviceName: "stripe" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "stripe",
          location: makeLocation({
            filePath: "src/server.ts",
            startLine: 6,
            endLine: 6,
          }),
          properties: { serviceName: "stripe" },
        }),
      ];
      const flows = detectDataFlows(files, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("route_data");
      expect(flows[0].targetComponentId).toBe("tp");
    });

    it("does not attribute external_api_call to outbound URL api assets in the same file", () => {
      const chatgpt = `import OpenAI from 'openai';
const x = new OpenAI();
void fetch("https://clipdrop-api.co/remove-background/v1", { method: "POST" });
`;
      const files: FileInfo[] = [
        {
          path: "services/chatgpt.js",
          name: "chatgpt.js",
          content: chatgpt,
          language: "javascript",
          size: chatgpt.length,
        },
      ];
      const components: DetectedComponent[] = [
        makeComponent({
          id: "http_api",
          name: "HTTP API",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, framework: "express" },
        }),
        makeComponent({
          id: "clipdrop",
          name: "https://clipdrop-api.co/remove-background/v1",
          type: "asset",
          subType: "api",
          properties: {
            url: "https://clipdrop-api.co/remove-background/v1",
            client: "fetch",
          },
          sourceLocations: [
            {
              filePath: "services/chatgpt.js",
              startLine: 3,
              endLine: 3,
            },
          ],
        }),
        makeComponent({
          id: "tp_openai",
          name: "Openai",
          type: "third_party",
          subType: "ai_provider",
          properties: { serviceName: "openai", client: "openai" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "openai",
          location: makeLocation({
            filePath: "services/chatgpt.js",
            startLine: 1,
            endLine: 1,
          }),
          properties: { serviceName: "openai", client: "openai" },
        }),
      ];
      const flows = detectDataFlows(files, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("http_api");
      expect(flows[0].targetComponentId).toBe("tp_openai");
    });

    it("sets method and endpoint from finding properties when available", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "tp",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: { serviceName: "auth0" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "auth0",
          properties: {
            serviceName: "auth0",
            httpMethod: "POST",
            url: "https://auth0.com/oauth/token",
          },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].method).toBe("POST");
      expect(flows[0].endpoint).toBe("https://auth0.com/oauth/token");
    });

    it("uses webhook type when URL suggests webhook/callback", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "tp",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: { serviceName: "stripe" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "stripe webhook",
          properties: {
            serviceName: "stripe",
            url: "https://api.stripe.com/webhooks",
          },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].type).toBe("webhook");
    });

    it("prefers section API source for non-frontend external calls in same section", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main_reedy",
          name: "reedy",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "reedy" },
        }),
        makeComponent({
          id: "api_reedy",
          name: "API",
          type: "asset",
          subType: "api",
          properties: { isSectionApiNode: true, section_id: "reedy" },
        }),
        makeComponent({
          id: "tp_openai",
          name: "Openai",
          type: "third_party",
          subType: "ai_provider",
          properties: { serviceName: "openai", section_id: "reedy" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "openai",
          location: makeLocation({
            filePath: "reedy/lib/supabase/client.ts",
            startLine: 1,
            endLine: 1,
          }),
          properties: { serviceName: "openai", section_id: "reedy" },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      const tpFlow = flows.find((f) => f.targetComponentId === "tp_openai");
      expect(tpFlow).toBeDefined();
      expect(tpFlow?.sourceComponentId).toBe("api_reedy");
    });

    it("keeps main app source for clearly frontend runtime external calls", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main_reedy",
          name: "reedy",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "reedy" },
        }),
        makeComponent({
          id: "api_reedy",
          name: "API",
          type: "asset",
          subType: "api",
          properties: { isSectionApiNode: true, section_id: "reedy" },
        }),
        makeComponent({
          id: "tp_auth0",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: { serviceName: "auth0", section_id: "reedy" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "auth0",
          location: makeLocation({
            filePath: "reedy/components/header/user-menu.tsx",
            startLine: 42,
            endLine: 42,
          }),
          properties: { serviceName: "auth0", section_id: "reedy" },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      const tpFlow = flows.find((f) => f.targetComponentId === "tp_auth0");
      expect(tpFlow).toBeDefined();
      expect(tpFlow?.sourceComponentId).toBe("main_reedy");
    });

    it("skips manifest-only external_api_call findings", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main_reedy",
          name: "reedy",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "reedy" },
        }),
        makeComponent({
          id: "tp_openai",
          name: "Openai",
          type: "third_party",
          subType: "ai_provider",
          properties: { serviceName: "openai", section_id: "reedy" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "openai",
          location: makeLocation({
            filePath: "reedy/package.json",
            startLine: 1,
            endLine: 1,
          }),
          properties: { serviceName: "openai", section_id: "reedy" },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(0);
    });

    it("prefers section API source for python route-handler style files", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main_backend",
          name: "backend",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "backend" },
        }),
        makeComponent({
          id: "api_backend",
          name: "API",
          type: "asset",
          subType: "api",
          properties: { isSectionApiNode: true, section_id: "backend" },
        }),
        makeComponent({
          id: "tp_openai",
          name: "Openai",
          type: "third_party",
          subType: "ai_provider",
          properties: { serviceName: "openai", section_id: "backend" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "openai",
          location: makeLocation({
            filePath: "backend/routers/chat.py",
            startLine: 88,
            endLine: 88,
          }),
          properties: { serviceName: "openai", section_id: "backend" },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      const tpFlow = flows.find((f) => f.targetComponentId === "tp_openai");
      expect(tpFlow).toBeDefined();
      expect(tpFlow?.sourceComponentId).toBe("api_backend");
    });
  });

  describe("service-to-service (express_route)", () => {
    it("produces api_call flow from express_route to matching asset when target is not source", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "Application",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "auth-api",
          name: "Auth API",
          type: "asset",
          subType: "api",
          properties: {},
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "express_route",
          name: "Auth API",
          properties: { path: "/auth" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].type).toBe("api_call");
      expect(flows[0].sourceComponentId).toBe("app");
      expect(flows[0].targetComponentId).toBe("auth-api");
      expect(flows[0].targetScope).toBe("unknown");
    });

    it("classifies targetScope as cross_section_internal for cross-section internal flow", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app-s1",
          name: "Service 1",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, section_id: "s1" },
        }),
        makeComponent({
          id: "api-s2",
          name: "Payments API",
          type: "asset",
          subType: "api",
          properties: { section_id: "s2" },
        }),
      ];

      const findings: RawFinding[] = [
        makeFinding({
          pattern: "express_route",
          name: "Payments API",
          properties: {},
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].targetScope).toBe("cross_section_internal");
      expect(flows[0].targetScopeConfidence).toBe("high");
      expect(flows[0].targetScopeReason).toBe("different-section-id");
    });

    it("uses section API node as source for express_route flows and adds main->API edge", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main-backend",
          name: "Backend",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "backend" },
        }),
        makeComponent({
          id: "api-backend",
          name: "API",
          type: "asset",
          subType: "api",
          properties: { isSectionApiNode: true, section_id: "backend" },
        }),
        makeComponent({
          id: "payments-service",
          name: "Payments Service",
          type: "asset",
          subType: "service",
          properties: { section_id: "backend" },
        }),
      ];

      const findings: RawFinding[] = [
        makeFinding({
          pattern: "express_route",
          name: "Payments Service",
          properties: { section_id: "backend", path: "/payments" },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      const routeFlow = flows.find((f) => f.targetComponentId === "payments-service");
      const mainToApi = flows.find(
        (f) =>
          f.sourceComponentId === "main-backend" &&
          f.targetComponentId === "api-backend",
      );

      expect(routeFlow).toBeDefined();
      expect(routeFlow?.sourceComponentId).toBe("api-backend");
      expect(mainToApi).toBeDefined();
      expect(mainToApi?.targetScope).toBe("local");
      expect(mainToApi?.targetScopeReason).toBe("main-to-section-api");
    });

    it("does not target main application from express_route matching", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main-backend",
          name: "reedy",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "backend" },
        }),
        makeComponent({
          id: "api-backend",
          name: "API",
          type: "asset",
          subType: "api",
          properties: { isSectionApiNode: true, section_id: "backend" },
        }),
      ];

      const findings: RawFinding[] = [
        makeFinding({
          pattern: "express_route",
          name: "reedy",
          properties: { section_id: "backend" },
        }),
      ];

      const flows = detectDataFlows(emptyFiles, components, findings);
      const apiToMain = flows.find(
        (f) =>
          f.sourceComponentId === "api-backend" &&
          f.targetComponentId === "main-backend",
      );
      expect(apiToMain).toBeUndefined();
    });
  });

  describe("internal fetch mapping", () => {
    it("does not create API self-loop when section API node is the source", () => {
      const files: FileInfo[] = [
        {
          path: "frontend/app/page.tsx",
          name: "page.tsx",
          language: "typescript",
          size: 64,
          content: "async function load(){ await fetch('/api/auth/login'); }",
        },
      ];

      const components: DetectedComponent[] = [
        makeComponent({
          id: "main-front",
          name: "Frontend",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "frontend" },
        }),
        makeComponent({
          id: "api-front",
          name: "API",
          type: "asset",
          subType: "api",
          properties: {
            isSectionApiNode: true,
            section_id: "frontend",
            path: "/api",
          },
        }),
      ];

      const flows = detectDataFlows(files, components, [], [
        {
          id: "frontend",
          label: "frontend",
          role: "service",
          sectionDir: "frontend",
          manifestPaths: ["frontend/package.json"],
        },
      ]);

      const hasSelfLoop = flows.some(
        (f) => f.sourceComponentId === "api-front" && f.targetComponentId === "api-front",
      );
      expect(hasSelfLoop).toBe(false);
    });

    it("falls back to merged HTTP API surface when no route-named asset matches", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "Application",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "http-api",
          name: "HTTP API",
          type: "asset",
          subType: "api",
          properties: { path: "/users" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "express_route",
          name: "GET /users",
          properties: { httpMethod: "GET", path: "/users" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].targetComponentId).toBe("http-api");
    });
  });

  describe("actors", () => {
    it("produces api_call flow from matching actor component to application", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "Application",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "actor",
          name: "Customer",
          type: "actor",
          subType: "customer",
          properties: {},
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "web_actor",
          name: "Customer",
          properties: { actorType: "customer" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].type).toBe("api_call");
      expect(flows[0].sourceComponentId).toBe("actor");
      expect(flows[0].targetComponentId).toBe("app");
    });

    it("produces api_call flow from service_actor to the application", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "service",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "admin",
          name: "Admin user",
          type: "actor",
          subType: "employee",
          properties: {},
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "service_actor",
          name: "Admin user",
          properties: {},
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("admin");
      expect(flows[0].targetComponentId).toBe("app");
    });
  });

  describe("no structural dedupe (handled separately)", () => {
    it("emits a flow per matching finding; structural dedupe is handled by data-flow/dedupe", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "db",
          name: "PostgreSQL",
          type: "asset",
          subType: "database",
          properties: { databaseType: "postgresql" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "pg",
          location: makeLocation({ startLine: 1 }),
          properties: { databaseType: "postgresql" },
        }),
        makeFinding({
          pattern: "database_connection",
          name: "pg",
          location: makeLocation({ startLine: 5 }),
          properties: { databaseType: "postgresql" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(2);
      expect(flows[0].sourceComponentId).toBe("app");
      expect(flows[0].targetComponentId).toBe("db");
      expect(flows[1].sourceComponentId).toBe("app");
      expect(flows[1].targetComponentId).toBe("db");
    });
  });

  describe("auth_middleware", () => {
    it("creates api_call flow from main application to auth_service", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "HTTP API",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true, framework: "express" },
        }),
        makeComponent({
          id: "jwt",
          name: "Jwt",
          type: "asset",
          subType: "auth_service",
          properties: {},
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "auth_middleware",
          name: "jwt",
          location: makeLocation({ filePath: "src/auth.js", startLine: 5 }),
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("app");
      expect(flows[0].targetComponentId).toBe("jwt");
      expect(flows[0].type).toBe("api_call");
    });

    it("falls back to Auth0 third_party in the same section when auth_service asset is missing", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app-backend",
          name: "Backend",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "backend" },
        }),
        makeComponent({
          id: "auth0-backend",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: { serviceName: "auth0", section_id: "backend" },
        }),
        makeComponent({
          id: "auth0-frontend",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          properties: { serviceName: "auth0", section_id: "frontend" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "auth_middleware",
          name: "auth0 guard",
          location: makeLocation({
            filePath: "backend/src/auth/guards/auth0.guard.ts",
            startLine: 8,
          }),
          properties: { section_id: "backend" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(1);
      expect(flows[0].sourceComponentId).toBe("app-backend");
      expect(flows[0].targetComponentId).toBe("auth0-backend");
      expect(flows[0].type).toBe("api_call");
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty components", () => {
      const flows = detectDataFlows(emptyFiles, [], []);
      expect(flows).toHaveLength(0);
    });

    it("returns empty array for empty findings", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, []);
      expect(flows).toHaveLength(0);
    });

    it("skips database_connection when no matching target component", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "unknown-db",
          properties: { databaseType: "unknown" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(0);
    });

    it("skips external_api_call when no matching third_party component", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "external_api_call",
          name: "unknown-service",
          properties: { serviceName: "unknown" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(0);
    });

    it("assigns unique id and confidence to each flow", () => {
      const components: DetectedComponent[] = [
        makeComponent({
          id: "app",
          name: "App",
          type: "asset",
          subType: "api",
          properties: { isMainApplication: true },
        }),
        makeComponent({
          id: "db",
          name: "PostgreSQL",
          type: "asset",
          subType: "database",
          properties: { databaseType: "postgresql" },
        }),
        makeComponent({
          id: "tp",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: { serviceName: "stripe" },
        }),
      ];
      const findings: RawFinding[] = [
        makeFinding({
          pattern: "database_connection",
          name: "pg",
          confidence: 0.85,
          properties: { databaseType: "postgresql" },
        }),
        makeFinding({
          pattern: "external_api_call",
          name: "stripe",
          confidence: 0.95,
          properties: { serviceName: "stripe" },
        }),
      ];
      const flows = detectDataFlows(emptyFiles, components, findings);
      expect(flows).toHaveLength(2);
      const ids = flows.map((f) => f.id);
      expect(new Set(ids).size).toBe(2);
      expect(flows.every((f) => typeof f.confidence === "number" && f.confidence >= 0 && f.confidence <= 1)).toBe(true);
    });

    it("keeps unique flow ids when adding synthetic main->API edge after internal fetch flows", () => {
      const files: FileInfo[] = [
        {
          path: "frontend/app/page.tsx",
          name: "page.tsx",
          language: "typescript",
          size: 64,
          content: "async function load(){ await fetch('/api/auth/login'); }",
        },
      ];
      const components: DetectedComponent[] = [
        makeComponent({
          id: "main-front",
          name: "Frontend",
          type: "asset",
          subType: "application",
          properties: { isMainApplication: true, section_id: "frontend" },
        }),
        makeComponent({
          id: "api-front",
          name: "API",
          type: "asset",
          subType: "api",
          properties: {
            isSectionApiNode: true,
            section_id: "frontend",
            path: "/api",
          },
        }),
      ];
      const flows = detectDataFlows(files, components, [], [
        {
          id: "frontend",
          label: "frontend",
          role: "service",
          sectionDir: "frontend",
          manifestPaths: ["frontend/package.json"],
        },
      ]);
      const ids = flows.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
