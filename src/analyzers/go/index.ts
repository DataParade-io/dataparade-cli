import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectGoPatterns } from "./detector";

export function createGoAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectGoPatterns(file);
    },
  };
}
