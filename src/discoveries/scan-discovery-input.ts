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
  sourceLocation?: ScanDiscoverySourceLocation;
  sourceLocations?: ScanDiscoverySourceLocation[];
}

export interface ScanDiscoveryInput {
  components: ScanDiscoveryComponentInput[];
  dataFlows: ScanDiscoveryFlowInput[];
}

export interface PersonalDataMentionLandInput {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code?: string;
}

export interface PersonalDataDataItemLandInput {
  id: string;
  mentionId: string;
}

export interface PersonalDataLandInput {
  mentions: PersonalDataMentionLandInput[];
  dataItems: PersonalDataDataItemLandInput[];
}
