import {
  buildProposalTargetComponentIdRemap,
  buildSharedHandlerAiFileIndex,
  buildThirdPartyDataFlowSummary,
} from "../../../src/ai-enrichment/third-party-data-flow";
import { assignStableComponentIds } from "../../../src/core/pipeline/stable-component-ids";
import type { AiProposal } from "../../../src/ai-enrichment/types";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { FileInfo } from "../../../src/core/types/file";

function thirdPartyComponent(): DetectedComponent {
  return {
    id: "cmp_tp_supabase",
    name: "Supabase",
    type: "third_party",
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [
      {
        filePath: "src/auth/supabase-client.ts",
        startLine: 1,
        endLine: 1,
      },
    ],
    properties: {
      section_id: "src/auth",
      serviceName: "Supabase",
      integration_method: ["sdk"],
      api_type: "rest",
    },
  };
}

function files(): FileInfo[] {
  return [
    {
      path: "src/auth/supabase-client.ts",
      name: "supabase-client.ts",
      language: "typescript",
      size: 240,
      content: [
        "import { createClient } from '@supabase/supabase-js';",
        "await supabase.auth.signInWithPassword({ email, password });",
        "await supabase.storage.from('avatars').upload(path, file);",
        "await fetch('https://xyz.supabase.co/auth/v1/token', {",
        "  method: 'POST',",
        "  body: JSON.stringify({ email, password }),",
        "});",
      ].join("\n"),
    },
  ];
}

function providerProposal(): { id: string; proposal: AiProposal } {
  return {
    id: "provider_1",
    proposal: {
      kind: "component_patch",
      candidateType: "third_party",
      targetComponentId: "cmp_tp_supabase",
      setProperties: {
        authentication_method: "oauth2",
      },
      propertyEvidence: {
        authentication_method: [
          {
            filePath: "src/auth/supabase-client.ts",
            startLine: 2,
            endLine: 2,
            reason: "sign-in call detected",
          },
        ],
      },
      confidence: { score: 0.9, band: "high" },
      evidence: [
        {
          filePath: "src/auth/supabase-client.ts",
          startLine: 2,
          endLine: 2,
          reason: "auth method evidence",
        },
      ],
      provider: "openai",
      model: "gpt",
      agent: "tpAgent",
    },
  };
}

describe("buildThirdPartyDataFlowSummary", () => {
  it("builds data-flow entries from provider evidence and file signals", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [providerProposal()],
      appliedProposalIds: ["provider_1"],
      componentsAfterAi: [thirdPartyComponent()],
      files: files(),
      agenticTrace: [
        {
          candidateId: "cand_1",
          componentId: "cmp_tp_supabase",
          filesReviewed: ["src/auth/supabase-client.ts"],
          rounds: 2,
          finalProposalCount: 1,
          toolCalls: [],
        },
      ],
    });

    expect(summary.totals.thirdPartiesAnalyzed).toBe(1);
    expect(summary.totals.withDataShared).toBe(1);
    expect(summary.entries[0]?.source).toBe("provider");
    expect(summary.entries[0]?.capabilities).toEqual(
      expect.arrayContaining(["auth", "rest", "sdk", "storage"]),
    );
    expect(summary.entries[0]?.dataShared.map((entry) => entry.category)).toEqual(
      expect.arrayContaining(["content_files", "credentials"]),
    );
  });

  it("does not classify auth callback error.message as content_files for Auth0", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_auth0",
          name: "Auth0",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/auth/callback/route.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/auth",
            serviceName: "auth0",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/auth/callback/route.ts",
          name: "route.ts",
          language: "typescript",
          size: 140,
          content: [
            "const token = result.id_token;",
            "return NextResponse.redirect(",
            "  new URL(`/auth?error=${encodeURIComponent(error.message || 'Authentication failed')}`, request.url)",
            ");",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.dataShared.map((x) => x.category)).not.toContain("content_files");
  });

  it("does not include ai_inference capability from metadata without ai evidence", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_supabase_meta",
          name: "Supabase",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "src/supabase/client.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "src/supabase",
            serviceName: "supabase",
            integration_method: ["ai_inference", "sdk"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "src/supabase/client.ts",
          name: "client.ts",
          language: "typescript",
          size: 180,
          content: [
            "import { createClient } from '@supabase/supabase-js';",
            "const sb = createClient(url, key);",
            "await sb.auth.getUser(token);",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.capabilities).toContain("sdk");
    expect(entry?.capabilities).not.toContain("ai_inference");
  });

  it("keeps token-based auth as auth_artifacts without email/password credentials", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_openai",
          name: "OpenAI",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/assistant/route.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/assistant",
            serviceName: "openai",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/assistant/route.ts",
          name: "route.ts",
          language: "typescript",
          size: 180,
          content: [
            "const token = process.env.OPENAI_API_KEY;",
            "await fetch('https://api.openai.com/v1/chat/completions', {",
            "  headers: { Authorization: `Bearer ${token}` },",
            "  body: JSON.stringify({ model: 'gpt-4.1', input_text: prompt }),",
            "});",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const categories = entry?.dataShared.map((x) => x.category) ?? [];
    expect(categories).toContain("auth_artifacts");
    expect(categories).not.toContain("credentials");
  });

  it("does not infer Auth0 content/storage from unrelated file-upload lines", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_auth0_mixed",
          name: "Auth0",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/auth/mixed.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/auth",
            serviceName: "auth0",
            integration_method: ["storage", "api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/auth/mixed.ts",
          name: "mixed.ts",
          language: "typescript",
          size: 260,
          content: [
            "const auth0Domain = process.env.AUTH0_DOMAIN;",
            "await fetch(`https://${auth0Domain}/oauth/token`, { method: 'POST' });",
            "// unrelated logic below",
            "const bucket = 'uploads';",
            "await uploadBytes(bucketRef, fileBlob);",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const categories = entry?.dataShared.map((x) => x.category) ?? [];
    expect(categories).toContain("auth_artifacts");
    expect(categories).not.toContain("content_files");
    expect(entry?.capabilities).not.toContain("storage");
  });

  it("infers ai_inference for Google AI when nearby prompt lines are present", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_google_ai",
          name: "Google Ai",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/assistant/google.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/assistant",
            serviceName: "google_ai",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/assistant/google.ts",
          name: "google.ts",
          language: "typescript",
          size: 230,
          content: [
            "import { GoogleGenerativeAI } from '@google/generative-ai';",
            "const model = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);",
            "const request = { input_text: prompt };",
            "const out = await model.generateContent(request);",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.capabilities).toContain("ai_inference");
    expect(entry?.dataShared.map((x) => x.labels).flat()).toContain("prompt_input");
  });

  it("does not infer ai_inference for Google Auth token exchanges", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_google_auth",
          name: "Google Auth",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/auth/google.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/auth",
            serviceName: "google_auth",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/auth/google.ts",
          name: "google.ts",
          language: "typescript",
          size: 260,
          content: [
            "const token = await fetch('https://oauth2.googleapis.com/token', {",
            "  method: 'POST',",
            "  headers: { Authorization: `Bearer ${clientSecret}` },",
            "  body: JSON.stringify({ code, client_id, client_secret }),",
            "});",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.capabilities).toContain("auth");
    expect(entry?.capabilities).not.toContain("ai_inference");
  });

  it("infers ai_inference from GoogleGenAI SDK usage", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_google_ai_sdk",
          name: "Google Ai",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/assistant/route.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/assistant",
            serviceName: "google_ai",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/assistant/route.ts",
          name: "route.ts",
          language: "typescript",
          size: 220,
          content: [
            "import { GoogleGenAI } from '@google/genai';",
            "const ai = new GoogleGenAI({ apiKey });",
            "const result = await ai.models.generateContent({ model: 'gemini-2.0', contents: prompt });",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.capabilities).toContain("ai_inference");
    expect(entry?.dataShared.map((x) => x.labels).flat()).toContain("prompt_input");
  });

  it("detects first_name and last_name as explicit profile signals", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_profile_vendor",
          name: "ProfileVendor",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "app/api/profile/vendor.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "app/api/profile",
            serviceName: "profilevendor",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "app/api/profile/vendor.ts",
          name: "vendor.ts",
          language: "typescript",
          size: 180,
          content: [
            "const payload = { first_name, last_name, user_id };",
            "await fetch('https://api.profilevendor.com/users', {",
            "  method: 'POST',",
            "  body: JSON.stringify(payload),",
            "});",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const labels = entry?.dataShared.map((x) => x.labels).flat() ?? [];
    expect(labels).toContain("first_name");
    expect(labels).toContain("last_name");
  });

  it("does not detect passport_number from Passport auth framework names", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_auth0_passport",
          name: "Auth0",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "backend/src/auth/strategies/auth0.strategy.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "backend/src/auth",
            serviceName: "auth0",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "backend/src/auth/strategies/auth0.strategy.ts",
          name: "auth0.strategy.ts",
          language: "typescript",
          size: 220,
          content: [
            "import { PassportStrategy } from '@nestjs/passport';",
            "import { ExtractJwt, Strategy } from 'passport-jwt';",
            "jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const labels = entry?.dataShared.map((x) => x.labels).flat() ?? [];
    expect(labels).not.toContain("passport_number");
  });

  it("does not classify ip address mentions as profile address", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_sentry",
          name: "Sentry",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "backend/src/instrument.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "backend/src",
            serviceName: "sentry",
            integration_method: ["sdk"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "backend/src/instrument.ts",
          name: "instrument.ts",
          language: "typescript",
          size: 160,
          content: [
            "Sentry.init({",
            "  // automatic IP address collection on events",
            "  sendDefaultPii: true,",
            "});",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const labels = entry?.dataShared.map((x) => x.labels).flat() ?? [];
    expect(labels).not.toContain("address");
  });

  it("does not classify OAuth state parameter as profile address", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_auth0_state",
          name: "Auth0",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "backend/src/auth/auth.service.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "backend/src/auth",
            serviceName: "auth0",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "backend/src/auth/auth.service.ts",
          name: "auth.service.ts",
          language: "typescript",
          size: 180,
          content: [
            "const state = generateRandomState();",
            "const authUrl = `https://auth0.com/authorize?state=${state}`;",
            "return authUrl;",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const labels = entry?.dataShared.map((x) => x.labels).flat() ?? [];
    expect(labels).not.toContain("address");
  });

  it("derives dataShared from provider evidence reasons when scan signals are missing", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [
        {
          id: "provider_aws_1",
          proposal: {
            kind: "component_patch",
            candidateType: "third_party",
            targetComponentId: "cmp_tp_aws_provider_only",
            setProperties: {
              integration_method: ["sdk", "api"],
            },
            confidence: { score: 0.92, band: "high" },
            evidence: [
              {
                filePath: "backend/lambdas/create-db/index.js",
                startLine: 20,
                endLine: 30,
                reason: "getSecret() retrieves DB_PASSWORD from AWS Secrets Manager",
              },
              {
                filePath: "backend/lambdas/create-db/index.js",
                startLine: 50,
                endLine: 60,
                reason: "Client connects to RDS database via host/port/database parameters",
              },
            ],
            provider: "openai",
            model: "gpt",
            agent: "tpAgent",
          },
        },
      ],
      appliedProposalIds: ["provider_aws_1"],
      componentsAfterAi: [
        {
          id: "cmp_tp_aws_provider_only",
          name: "Aws",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "backend/lambdas/create-db/index.js", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "backend/lambdas/create-db",
            serviceName: "aws",
            integration_method: ["sdk", "api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "backend/lambdas/create-db/index.js",
          name: "index.js",
          language: "javascript",
          size: 120,
          content: "exports.handler = async () => {};",
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.dataShared.map((x) => x.category)).toEqual(
      expect.arrayContaining(["auth_artifacts", "credentials", "identifiers"]),
    );
    expect(entry?.direction).toBe("outbound_to_third_party");
  });

  it("does not bleed unrelated address-like signals from broad section roots", () => {
    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_tp_aws_nobleed",
          name: "Aws",
          type: "third_party",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: "backend/src/aws-client.ts", startLine: 1, endLine: 1 }],
          properties: {
            section_id: "backend",
            serviceName: "aws",
            integration_method: ["sdk"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: "backend/src/aws-client.ts",
          name: "aws-client.ts",
          language: "typescript",
          size: 200,
          content: [
            "import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';",
            "const c = new SecretsManagerClient({ region: 'us-east-1' });",
            "await c.send(command);",
          ].join("\n"),
        },
        {
          path: "backend/src/unrelated-profile.ts",
          name: "unrelated-profile.ts",
          language: "typescript",
          size: 120,
          content: [
            "const mailing_address = profile.address;",
            "console.log(mailing_address);",
          ].join("\n"),
        },
      ],
      agenticTrace: [],
    });

    const entry = summary.entries[0];
    expect(entry).toBeDefined();
    const labels = entry?.dataShared.map((x) => x.labels).flat() ?? [];
    expect(labels).not.toContain("address");
  });

  it("attributes shared prompt assembly to all AI providers in the same handler file", () => {
    const handlerPath = "app/api/assistant/route.ts";
    const handlerContent = [
      "function buildPrompt(body: { text: string }) {",
      "  return { input_text: body.text };",
      "}",
      "export async function POST(req: Request) {",
      "  const prompt = buildPrompt(await req.json());",
      "  await fetch('https://api.openai.com/v1/chat/completions', {",
      "    method: 'POST',",
      "    body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: prompt }] }),",
      "  });",
      "  const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });",
      "  await genai.models.generateContent({ model: 'gemini-2.0', contents: prompt });",
      "}",
    ].join("\n");

    const openai: DetectedComponent = {
      id: "cmp_openai",
      name: "Openai",
      type: "third_party",
      subType: "ai_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: handlerPath, startLine: 1, endLine: 1 }],
      properties: {
        section_id: "reedy",
        serviceName: "openai",
        client: "openai",
        integration_method: ["api"],
        api_type: "rest",
      },
    };
    const google: DetectedComponent = {
      id: "cmp_google",
      name: "Google",
      type: "third_party",
      subType: "ai_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [{ filePath: handlerPath, startLine: 1, endLine: 1 }],
      properties: {
        section_id: "reedy",
        serviceName: "google",
        client: "google_ai",
        integration_method: ["api"],
        api_type: "rest",
      },
    };

    const files: FileInfo[] = [
      {
        path: handlerPath,
        name: "route.ts",
        language: "typescript",
        size: handlerContent.length,
        content: handlerContent,
      },
    ];

    expect(buildSharedHandlerAiFileIndex([openai, google], files)).toEqual(
      new Set([handlerPath]),
    );

    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [openai, google],
      files,
    });

    for (const id of ["cmp_openai", "cmp_google"] as const) {
      const entry = summary.entries.find((e) => e.componentId === id);
      expect(entry?.capabilities).toContain("ai_inference");
      expect(entry?.dataShared.map((x) => x.labels).flat()).toContain("prompt_input");
      expect(entry?.notes).toContain("shared_ai_handler_prompt_attribution");
      expect(
        entry?.evidence.some((ev) => ev.reason.includes("shared_ai_handler")),
      ).toBe(true);
    }
  });

  it("does not attribute shared prompts to non-AI vendors in the same handler file", () => {
    const handlerPath = "app/api/mixed/route.ts";
    const handlerContent = [
      "const prompt = buildPrompt(body);",
      "await fetch('https://api.openai.com/v1/chat/completions', {",
      "  method: 'POST',",
      "  body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),",
      "});",
      "await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, { method: 'POST' });",
    ].join("\n");

    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [
        {
          id: "cmp_openai",
          name: "Openai",
          type: "third_party",
          subType: "ai_provider",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: handlerPath, startLine: 1, endLine: 1 }],
          properties: {
            section_id: "reedy",
            serviceName: "openai",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
        {
          id: "cmp_auth0",
          name: "Auth0",
          type: "third_party",
          subType: "saas_service",
          confidence: 0.9,
          detectedFrom: [],
          sourceLocations: [{ filePath: handlerPath, startLine: 1, endLine: 1 }],
          properties: {
            section_id: "reedy",
            serviceName: "auth0",
            integration_method: ["api"],
            api_type: "rest",
          },
        },
      ],
      files: [
        {
          path: handlerPath,
          name: "route.ts",
          language: "typescript" as const,
          size: handlerContent.length,
          content: handlerContent,
        },
      ],
    });

    const openai = summary.entries.find((e) => e.componentId === "cmp_openai");
    const auth0 = summary.entries.find((e) => e.componentId === "cmp_auth0");
    expect(openai?.dataShared.map((x) => x.category)).toContain("content_files");
    expect(auth0?.dataShared.map((x) => x.category)).not.toContain("content_files");
  });

  it("maps post-AI proposal and trace ids to final stable component ids", () => {
    const postAiGoogle: DetectedComponent = {
      id: "cmp_old_google",
      name: "Google",
      type: "third_party",
      subType: "ai_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [
        { filePath: "reedy/app/api/assistant/route.ts", startLine: 1, endLine: 1 },
      ],
      properties: {
        section_id: "reedy",
        serviceName: "google",
        client: "google_ai",
        integration_method: ["api"],
        api_type: "rest",
      },
    };
    const postAiAuth0: DetectedComponent = {
      id: "cmp_old_auth0",
      name: "Auth0",
      type: "third_party",
      subType: "saas_service",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [
        { filePath: "reedy/app/api/auth/login/route.ts", startLine: 1, endLine: 1 },
      ],
      properties: {
        section_id: "reedy",
        serviceName: "auth0",
        integration_method: ["api"],
        api_type: "rest",
      },
    };

    const stable = assignStableComponentIds(
      [postAiAuth0, postAiGoogle],
      [],
    );
    const finalGoogle = stable.components.find((c) => c.name === "Google");
    const finalAuth0 = stable.components.find((c) => c.name === "Auth0");
    expect(finalGoogle?.id).toMatch(/^cmp_\d+$/);
    expect(finalGoogle?.id).not.toBe("cmp_old_google");

    const remap = buildProposalTargetComponentIdRemap(
      [postAiAuth0, postAiGoogle],
      stable.components,
    );
    expect(remap.get("cmp_old_google")).toBe(finalGoogle?.id);

    const summary = buildThirdPartyDataFlowSummary({
      proposals: [
        {
          id: "provider_1",
          proposal: {
            kind: "component_patch",
            candidateType: "third_party",
            targetComponentId: "cmp_old_google",
            setProperties: { authentication_method: "api_key" },
            propertyEvidence: {
              authentication_method: [
                {
                  filePath: "reedy/app/api/assistant/route.ts",
                  startLine: 10,
                  endLine: 10,
                  reason: "API key header",
                },
              ],
            },
            confidence: { score: 0.9, band: "high" },
            evidence: [],
            provider: "anthropic",
            model: "claude",
            agent: "tpAgent",
          },
        },
      ],
      appliedProposalIds: ["provider_1"],
      componentsAfterAi: stable.components.filter((c) => c.type === "third_party"),
      files: [
        {
          path: "reedy/app/api/assistant/route.ts",
          name: "route.ts",
          language: "typescript",
          size: 80,
          content: "await fetch('https://generativelanguage.googleapis.com/v1/models');",
        },
      ],
      agenticTrace: [
        {
          candidateId: "cand_google",
          componentId: "cmp_old_google",
          filesReviewed: ["reedy/app/api/assistant/route.ts"],
          rounds: 1,
          finalProposalCount: 1,
          toolCalls: [],
        },
      ],
      proposalTargetComponentIdRemap: remap,
    });

    const googleEntry = summary.entries.find((e) => e.componentId === finalGoogle?.id);
    expect(googleEntry).toBeDefined();
    expect(googleEntry?.source).toBe("provider");
    expect(googleEntry?.notes).toContain("ai_provider_inference_present");
    expect(summary.entries.every((e) => /^cmp_\d+$/.test(e.componentId))).toBe(true);
  });

  it("includes managed-service third parties with heuristic-only insights when absent post-AI", () => {
    const postAiProvider: DetectedComponent = {
      id: "cmp_provider",
      name: "Google",
      type: "third_party",
      subType: "ai_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [
        { filePath: "reedy/app/api/assistant/route.ts", startLine: 1, endLine: 1 },
      ],
      properties: {
        section_id: "reedy",
        serviceName: "google",
      },
    };
    const finalProvider = { ...postAiProvider, id: "cmp_1" };
    const finalManaged: DetectedComponent = {
      id: "cmp_2",
      name: "Google AI",
      type: "third_party",
      subType: "ai_provider",
      confidence: 0.78,
      detectedFrom: [],
      sourceLocations: [
        { filePath: "reedy/app/api/assistant/route.ts", startLine: 1, endLine: 1 },
      ],
      properties: {
        section_id: "reedy",
        managed_by_provider: "cmp_1",
        managed_service_key: "google_ai",
        serviceName: "google",
        generated_by: "provider_topology_fallback",
      },
    };

    const remap = buildProposalTargetComponentIdRemap(
      [postAiProvider],
      [finalProvider, finalManaged],
    );

    const summary = buildThirdPartyDataFlowSummary({
      proposals: [],
      appliedProposalIds: [],
      componentsAfterAi: [finalProvider, finalManaged],
      files: [
        {
          path: "reedy/app/api/assistant/route.ts",
          name: "route.ts",
          language: "typescript",
          size: 80,
          content: "await fetch('https://generativelanguage.googleapis.com/v1/models');",
        },
      ],
      proposalTargetComponentIdRemap: remap,
    });

    expect(summary.totals.thirdPartiesAnalyzed).toBe(2);
    const managedEntry = summary.entries.find((e) => e.componentId === "cmp_2");
    expect(managedEntry).toBeDefined();
    expect(managedEntry?.source).toBe("heuristic");
    expect(managedEntry?.notes).toContain("no_provider_inference_for_component");
  });
});

