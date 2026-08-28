import { promises as fs } from "fs";
import * as path from "path";
import type { FileInfo, FileLanguage } from "../core/types/file";
import {
  DEFAULT_EXCLUDED_FILE_GLOBS,
  shouldSkipDirectoryName,
} from "../patterns/scan-exclusions";
import {
  gitignorePatternToRegex,
  gitignoreRulesForDir,
  isPathIgnored,
  type IgnoreRule,
  toPosixPath,
} from "./gitignore";
import { isSensitiveEnvPath } from "./sensitive-paths";

const DEFAULT_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_MAX_FILE_COUNT = 20_000;
const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB

export interface IngestOptions {
  maxFileSizeBytes?: number;
  maxFileCount?: number;
  maxTotalBytes?: number;
  excludePaths?: string[];
  onWarning?: (warning: string) => void;
}

type IngestState = {
  filesIncluded: number;
  totalBytesIncluded: number;
  fileCountLimitReached: boolean;
};

function normalizeUserPattern(pattern: string): string {
  return toPosixPath(pattern.replace(/^\.\/+/, "").trim());
}

function isExcludedByUserPatterns(
  relativePath: string,
  isDirectory: boolean,
  excludePaths: string[],
): boolean {
  const rel = toPosixPath(relativePath);
  for (const rawPattern of excludePaths) {
    const pattern = normalizeUserPattern(rawPattern);
    if (!pattern) continue;

    // Treat "dir/**" as excluding the directory itself and all descendants.
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3).replace(/\/$/, "");
      if (rel === prefix || rel.startsWith(`${prefix}/`)) return true;
    }

    const regex = gitignorePatternToRegex(pattern, isDirectory);
    if (regex.test(rel)) return true;
  }
  return false;
}

function getFileLanguage(filePath: string): FileLanguage | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  if (ext === ".ts" || ext === ".tsx") {
    return "typescript";
  }

  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    return "javascript";
  }

  if (ext === ".py") {
    return "python";
  }

  if (
    ext === ".cpp" ||
    ext === ".cc" ||
    ext === ".cxx" ||
    ext === ".c++" ||
    ext === ".hpp" ||
    ext === ".hh" ||
    ext === ".hxx" ||
    ext === ".ipp" ||
    ext === ".inl" ||
    ext === ".h"
  ) {
    return "cpp";
  }

  if (ext === ".cs" || ext === ".cshtml" || ext === ".razor") {
    return "csharp";
  }

  if (ext === ".go") {
    return "go";
  }

  if (ext === ".rs") {
    return "rust";
  }

  if (ext === ".java") {
    return "java";
  }

  // `.kts` covers Kotlin scripts, including Gradle build scripts — those are
  // build configuration rather than application code, but they are also where
  // a Kotlin service declares its dependencies.
  if (ext === ".kt" || ext === ".kts") {
    return "kotlin";
  }

  if (ext === ".json") {
    return "json";
  }

  if (ext === ".yaml" || ext === ".yml") {
    return "yaml";
  }

  if (ext === ".tf" || ext === ".tfvars") {
    return "terraform";
  }

  // Handle .env, .env.local, etc. (basename starts with .env)
  if (base === ".env" || base.startsWith(".env.")) {
    return "env";
  }

  return undefined;
}

/**
 * Resolve a user-supplied scan path to a directory (for config, Terraform cwd,
 * section discovery) and an ingest target (directory walk or a single file).
 */
export async function resolveScanFilesystemEntry(rootPath: string): Promise<{
  scanRootDir: string;
  ingestTarget: string;
}> {
  const abs = path.resolve(rootPath);
  const st = await fs.stat(abs);
  if (st.isDirectory()) {
    return { scanRootDir: abs, ingestTarget: abs };
  }
  if (st.isFile()) {
    return { scanRootDir: path.dirname(abs), ingestTarget: abs };
  }
  throw new Error(`Scan path is not a file or directory: ${abs}`);
}

async function ingestSingleFile(
  fileAbs: string,
  options: Required<
    Pick<IngestOptions, "maxFileSizeBytes" | "maxFileCount" | "maxTotalBytes">
  > &
    Pick<IngestOptions, "onWarning" | "excludePaths">,
): Promise<FileInfo[]> {
  const scanRootDir = path.dirname(fileAbs);
  const relativePath = toPosixPath(path.relative(scanRootDir, fileAbs));
  const basename = path.basename(fileAbs);
  const excludePaths = options.excludePaths ?? [];

  if (isSensitiveEnvPath(relativePath) || isSensitiveEnvPath(basename)) {
    options.onWarning?.(
      `Skipped "${basename}" (excluded for security).`,
    );
    return [];
  }

  if (
    relativePath &&
    isExcludedByUserPatterns(relativePath, false, excludePaths)
  ) {
    options.onWarning?.(
      `Skipped "${relativePath}" (matched exclude pattern).`,
    );
    return [];
  }

  const language = getFileLanguage(fileAbs);
  if (!language) {
    options.onWarning?.(
      `Skipping unsupported file type: ${basename}`,
    );
    return [];
  }

  const stat = await fs.stat(fileAbs);
  if (stat.size > options.maxFileSizeBytes) {
    options.onWarning?.(
      `Skipped "${path.basename(fileAbs)}" (${stat.size} bytes) because it exceeds max file size (${options.maxFileSizeBytes} bytes).`,
    );
    return [];
  }

  if (stat.size > options.maxTotalBytes) {
    options.onWarning?.(
      `Skipped "${path.basename(fileAbs)}" because ingest byte budget (${options.maxTotalBytes} bytes) would be exceeded.`,
    );
    return [];
  }

  const content = await fs.readFile(fileAbs, "utf8");

  return [
    {
      path: relativePath,
      name: basename,
      content,
      language,
      size: stat.size,
    },
  ];
}

async function walkDirectory(
  currentDir: string,
  rootDir: string,
  accumulatedRules: IgnoreRule[],
  files: FileInfo[],
  options: Required<
    Pick<IngestOptions, "maxFileSizeBytes" | "maxFileCount" | "maxTotalBytes">
  > &
    Pick<IngestOptions, "onWarning" | "excludePaths">,
  state: IngestState,
): Promise<void> {
  if (state.fileCountLimitReached) return;
  const excludePaths = options.excludePaths ?? [];

  const rules = await gitignoreRulesForDir(currentDir, accumulatedRules);

  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (state.fileCountLimitReached) return;

    const entryPath = path.join(currentDir, entry.name);
    const relativePath = toPosixPath(path.relative(rootDir, entryPath));

    if (entry.isDirectory()) {
      if (shouldSkipDirectoryName(entry.name)) {
        continue;
      }
      if (
        relativePath &&
        isExcludedByUserPatterns(relativePath, true, excludePaths)
      ) {
        continue;
      }

      if (isPathIgnored(entryPath, true, rules)) {
        continue;
      }

      await walkDirectory(entryPath, rootDir, rules, files, options, state);
    } else if (entry.isFile()) {
      if (
        relativePath &&
        isExcludedByUserPatterns(relativePath, false, excludePaths)
      ) {
        continue;
      }
      if (isPathIgnored(entryPath, false, rules)) {
        continue;
      }

      const language = getFileLanguage(entryPath);
      if (!language) continue;

      const stat = await fs.stat(entryPath);

      if (stat.size > options.maxFileSizeBytes) {
        options.onWarning?.(
          `Skipped "${relativePath}" (${stat.size} bytes) because it exceeds max file size (${options.maxFileSizeBytes} bytes).`,
        );
        continue;
      }

      if (
        state.totalBytesIncluded + stat.size >
        options.maxTotalBytes
      ) {
        options.onWarning?.(
          `Skipped "${relativePath}" because ingest byte budget (${options.maxTotalBytes} bytes) would be exceeded.`,
        );
        continue;
      }

      if (state.filesIncluded >= options.maxFileCount) {
        state.fileCountLimitReached = true;
        options.onWarning?.(
          `Stopped ingest after ${state.filesIncluded} files because max file count (${options.maxFileCount}) was reached.`,
        );
        return;
      }

      const content = await fs.readFile(entryPath, "utf8");

      files.push({
        path: relativePath,
        name: entry.name,
        content,
        language,
        size: stat.size,
      });
      state.filesIncluded += 1;
      state.totalBytesIncluded += stat.size;
    }
  }
}

export async function ingestFileSystem(
  rootPath: string,
  options: IngestOptions = {},
): Promise<FileInfo[]> {
  const abs = path.resolve(rootPath);
  const st = await fs.stat(abs);
  const resolvedOptions = {
    maxFileSizeBytes: options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES,
    maxFileCount: options.maxFileCount ?? DEFAULT_MAX_FILE_COUNT,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    excludePaths: [
      ...DEFAULT_EXCLUDED_FILE_GLOBS,
      ...(options.excludePaths ?? []),
    ],
    onWarning: options.onWarning,
  };

  if (st.isFile()) {
    return ingestSingleFile(abs, resolvedOptions);
  }

  if (!st.isDirectory()) {
    throw new Error(`Scan path is not a file or directory: ${abs}`);
  }

  const rootDir = abs;
  const files: FileInfo[] = [];
  const state: IngestState = {
    filesIncluded: 0,
    totalBytesIncluded: 0,
    fileCountLimitReached: false,
  };

  await walkDirectory(rootDir, rootDir, [], files, resolvedOptions, state);

  return files;
}

