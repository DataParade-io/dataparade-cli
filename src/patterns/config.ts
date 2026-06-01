import type { ActorDetectionConfig } from "../config/actor-detection-config";
import { loadActorDetectionConfig } from "../config/actor-detection-config";
import type { PropertyDetectionConfig } from "../config/property-detection-config";
import { loadPropertyDetectionConfig } from "../config/property-detection-config";
import type { ThirdPartyDetectionConfig } from "../config/third-party-detection-config";
import { loadThirdPartyDetectionConfig } from "../config/third-party-detection-config";
import type { TypeScriptPatternConfig } from "../analyzers/typescript/typescript-detection-config";
import { loadTypeScriptPatternConfig } from "../analyzers/typescript/typescript-detection-config";
import type { ClassifierConfig } from "../classifier/config";
import { loadClassifierConfig } from "../classifier/config";
import type { PythonPatternConfig } from "../analyzers/python/python-detection-config";
import { loadPythonPatternConfig } from "../analyzers/python/python-detection-config";
import type { TerraformPatternConfig } from "../analyzers/terraform/terraform-detection-config";
import { loadTerraformPatternConfig } from "../analyzers/terraform/terraform-detection-config";

export interface UnifiedPatternConfig {
  actors: ActorDetectionConfig;
  properties: PropertyDetectionConfig;
  thirdParty: ThirdPartyDetectionConfig;
  typescript: TypeScriptPatternConfig;
  classifier: ClassifierConfig;
  python: PythonPatternConfig;
  terraform: TerraformPatternConfig;
}

let cachedUnifiedConfig: UnifiedPatternConfig | undefined;

function validateUnifiedPatternConfig(unified: UnifiedPatternConfig): void {
  const classifierPatternIds = new Set(
    unified.classifier.patternDefaults.map((d) => d.patternId),
  );

  const emittedPatternIds = new Set<string>();

  // Actors.
  for (const rule of unified.actors.rules) {
    emittedPatternIds.add(String(rule.patternId));
  }

  // TypeScript.
  for (const fw of unified.typescript.routes.frameworks) {
    emittedPatternIds.add(String(fw.patternId));
  }
  for (const db of unified.typescript.dbClients) {
    emittedPatternIds.add(String(db.patternId));
  }
  for (const lib of unified.typescript.auth.libraries) {
    emittedPatternIds.add(String(lib.patternId));
  }
  emittedPatternIds.add(String(unified.typescript.heuristics.sqlKeyword.patternId));
  for (const key of unified.typescript.configKeys.keys) {
    emittedPatternIds.add(String(key.patternId));
  }

  // TS env/config patterns are driven by the engine, not by YAML fields.
  // Still treat them as "emitted" patterns so classifier config remains consistent.
  emittedPatternIds.add("env_variable");
  emittedPatternIds.add("config_file");

  // Python.
  for (const db of unified.python.dbClients) {
    emittedPatternIds.add(String(db.patternId));
  }
  if (unified.python.auth.jwt) {
    emittedPatternIds.add(String(unified.python.auth.jwt.patternId));
  }
  for (const d of unified.python.auth.decorators) {
    emittedPatternIds.add(String(d.patternId));
  }
  for (const fw of unified.python.routes.frameworks) {
    emittedPatternIds.add(String(fw.patternId));
  }
  if (unified.python.envConfig.envVariable) {
    emittedPatternIds.add(String(unified.python.envConfig.envVariable.patternId));
  }
  if (unified.python.envConfig.djangoSettings) {
    emittedPatternIds.add(
      String(unified.python.envConfig.djangoSettings.patternId),
    );
  }
  if (unified.python.envConfig.dotenvConfig) {
    emittedPatternIds.add(String(unified.python.envConfig.dotenvConfig.patternId));
  }
  for (const c of unified.python.externalApis.httpClients) {
    emittedPatternIds.add(String(c.patternId));
  }

  // Third-party external API pattern.
  for (const svc of unified.thirdParty.services) {
    emittedPatternIds.add(String(svc.patternId));
  }
  emittedPatternIds.add("external_api_call");
  emittedPatternIds.add("auth_middleware");
  emittedPatternIds.add("database_connection");
  emittedPatternIds.add("express_route");

  emittedPatternIds.add("terraform_resource");
  emittedPatternIds.add("terraform_module");
  emittedPatternIds.add("terraform_provider");

  const missingInClassifier = Array.from(emittedPatternIds).filter(
    (pid) => !classifierPatternIds.has(pid as any),
  );
  if (missingInClassifier.length > 0) {
    throw new Error(
      `Unified pattern config validation failed: classifier.pattern_defaults is missing ${missingInClassifier.join(", ")}.`,
    );
  }

  // Ensure third-party service catalog alignment (serviceName label).
  const patternServiceNames = unified.thirdParty.services.map((s) =>
    s.serviceName.toLowerCase(),
  );
  const classifierServiceNames = unified.classifier.thirdParties.map((s) =>
    s.serviceName.toLowerCase(),
  );

  const missingThirdPartyServices = patternServiceNames.filter(
    (svc) => !classifierServiceNames.includes(svc),
  );

  if (missingThirdPartyServices.length > 0) {
    throw new Error(
      `Unified pattern config validation failed: third-party classifier is missing serviceName(s) referenced in third-party.patterns.yaml: ${Array.from(
        new Set(missingThirdPartyServices),
      ).join(", ")}.`,
    );
  }
}

/**
 * Loads all pattern/classifier YAML configs into a single in-memory object
 * so analyzers and the shared pattern engine can access them in a
 * language-agnostic way.
 */
export function loadUnifiedPatternConfig(): UnifiedPatternConfig {
  // Jest tests sometimes mock individual YAML loaders (e.g. TypeScript config).
  // If we keep a process-wide cache, those mocks won't take effect.
  if (process.env.NODE_ENV !== "test") {
    if (cachedUnifiedConfig) {
      return cachedUnifiedConfig;
    }
  }

  const actors = loadActorDetectionConfig();
  const properties = loadPropertyDetectionConfig();
  const thirdParty = loadThirdPartyDetectionConfig();
  const typescript = loadTypeScriptPatternConfig();
  const classifier = loadClassifierConfig();
  const python = loadPythonPatternConfig();
  const terraform = loadTerraformPatternConfig();

  const unified: UnifiedPatternConfig = {
    actors,
    properties,
    thirdParty,
    typescript,
    classifier,
    python,
    terraform,
  };

  validateUnifiedPatternConfig(unified);

  if (process.env.NODE_ENV !== "test") {
    cachedUnifiedConfig = unified;
  }

  return unified;
}

