import type { FileInfo } from "../core/types/file";
import type { RawFinding } from "../core/types/detection";

export interface Analyzer {
  detect(file: FileInfo): RawFinding[];
}

