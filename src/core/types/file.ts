export type FileLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "yaml"
  | "env"
  | "python"
  | "terraform"
  | "dockerfile";

export interface FileInfo {
  path: string;
  name: string;
  content: string;
  language: FileLanguage;
  size: number;
}

export interface SourceLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  code?: string;
}

