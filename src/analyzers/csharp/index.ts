import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectCSharpPatterns } from "./detector";

export function createCSharpAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectCSharpPatterns(file);
    },
  };
}
