import type { SourceLocation } from "./file";

export type PatternId =
  | "express_route"
  | "database_connection"
  | "external_api_call"
  | "auth_middleware"
  | "config_file"
  | "env_variable"
  | "lambda_handler"
  | "container_service"
  | "web_actor"
  | "service_actor"
  | "terraform_resource"
  | "terraform_module"
  | "terraform_provider";

/** All valid pattern IDs; use for runtime validation (e.g. YAML config). */
export const PATTERN_IDS: readonly PatternId[] = [
  "express_route",
  "database_connection",
  "external_api_call",
  "auth_middleware",
  "config_file",
  "env_variable",
  "lambda_handler",
  "container_service",
  "web_actor",
  "service_actor",
  "terraform_resource",
  "terraform_module",
  "terraform_provider",
];

export interface RawFinding {
  pattern: PatternId;
  name: string;
  description?: string;
  confidence: number;
  location: SourceLocation;
  properties: Record<string, unknown>;
}

