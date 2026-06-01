import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import { detectTerraformPatterns } from "./detector";
import { loadTerraformPatternConfig } from "./terraform-detection-config";

export function createTerraformAnalyzer(): Analyzer {
  const config = loadTerraformPatternConfig();
  return {
    detect(file: FileInfo) {
      return detectTerraformPatterns(file, config);
    },
  };
}
