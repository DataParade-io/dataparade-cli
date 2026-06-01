export const DEFAULT_EXCLUDED_DIRS = new Set([
  "node_modules",
  "venv",
  ".venv",
  "site-packages",
  "vendor",
  "test",
  "tests",
  "__tests__",
  "__stories__",
  "e2e",
  "storybook-static",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".vscode",
  ".idea",
]);

/**
 * Files matching these globs are not scanned by default: they are never ingested and do not
 * contribute findings or AI context. This keeps unit tests (`*.spec.*`, `*.test.*`) and
 * Playwright bootstrap config, Storybook (`__stories__/`, `*.stories.*`) out of the
 * production-oriented graph. (`.storybook/` is skipped as a hidden directory.)
 *
 * Values are passed as `excludePaths`; expanded explicitly (no `{a,b}` brace groups) because
 * the matcher only supports `*`, `**`, `?`.
 *
 * @see createDefaultScanConfiguration — always prepends these before user `excludePaths`.
 */
export const DEFAULT_EXCLUDED_FILE_GLOBS: readonly string[] = [
  "**/*.spec.ts",
  "*.spec.ts",
  "**/*.spec.tsx",
  "*.spec.tsx",
  "**/*.spec.js",
  "*.spec.js",
  "**/*.spec.jsx",
  "*.spec.jsx",
  "**/*.test.ts",
  "*.test.ts",
  "**/*.test.tsx",
  "*.test.tsx",
  "**/*.test.js",
  "*.test.js",
  "**/*.test.jsx",
  "*.test.jsx",
  "**/playwright.config.*",
  "playwright.config.*",
  "**/*.stories.ts",
  "*.stories.ts",
  "**/*.stories.tsx",
  "*.stories.tsx",
  "**/*.stories.js",
  "*.stories.js",
  "**/*.stories.jsx",
  "*.stories.jsx",
  "**/*.stories.mdx",
  "*.stories.mdx",
  "**/.env",
  "**/.env.*",
  ".env",
  ".env.*",
];

export function shouldSkipDirectoryName(dirName: string): boolean {
  // Hidden tooling/cache directories are noisy for structural scanning.
  if (dirName.startsWith(".")) return true;
  return DEFAULT_EXCLUDED_DIRS.has(dirName);
}
