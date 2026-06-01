import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectPythonPatterns } from "./detector";

export function createPythonAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectPythonPatterns(file);
    },
  };
}

