import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectPatterns } from "./detector";

export function createTypeScriptAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectPatterns(file);
    },
  };
}

