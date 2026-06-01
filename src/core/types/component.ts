import type { SourceLocation } from "./file";

export type ComponentType = "asset" | "actor" | "third_party";

export interface DetectedFromRef {
  pattern: string;
  sourceLocation?: SourceLocation;
}

export interface DetectedComponent {
  id: string;
  name: string;
  type: ComponentType;
  subType?: string;
  description?: string;
  confidence: number;
  detectedFrom: DetectedFromRef[];
  sourceLocations: SourceLocation[];
  properties: Record<string, unknown>;
  dataFlowIds?: string[];
}

