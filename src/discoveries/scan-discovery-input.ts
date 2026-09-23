export interface ScanDiscoverySourceLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  code?: string;
}

export interface ScanDiscoveryComponentInput {
  id: string;
  name: string;
  type: string;
  subType: string;
  confidence: number;
  sourceLocations: ScanDiscoverySourceLocation[];
}

export interface ScanDiscoveryFlowInput {
  id: string;
  sourceComponentId: string;
  targetComponentId: string;
  type: string;
  confidence: number;
  targetScope?: string;
}

export interface ScanDiscoveryMentionInput {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code?: string;
  labels: string[];
}

export interface ScanDiscoveryDataItemInput {
  id: string;
  mentionIds: string[];
  labels: string[];
}

export interface ScanDiscoveryInput {
  components: ScanDiscoveryComponentInput[];
  dataFlows: ScanDiscoveryFlowInput[];
  mentions: ScanDiscoveryMentionInput[];
  dataItems: ScanDiscoveryDataItemInput[];
}
