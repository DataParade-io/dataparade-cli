import type { Analyzer } from "../types";
import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { detectJvmPatterns } from "./detector";

/**
 * One analyzer serves both Java and Kotlin: they share the JVM package
 * namespace, the Maven/Gradle coordinate space, the Spring and Jakarta
 * annotation vocabulary, and JDBC. Where the languages genuinely differ
 * (declaration grammar, Ktor, Exposed) the parser branches on
 * `FileInfo.language` and the rules are gated by import package.
 */
export function createJvmAnalyzer(): Analyzer {
  return {
    detect(file: FileInfo): RawFinding[] {
      return detectJvmPatterns(file);
    },
  };
}
