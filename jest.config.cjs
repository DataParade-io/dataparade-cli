/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  // Built by `pnpm build` (see tsconfig "paths" and scripts/vendor-kb-compare.mjs).
  moduleNameMapper: { "^@dataparade/kb-compare$": "<rootDir>/../packages/kb-compare/dist/src/index.js" },
  collectCoverageFrom: ["src/**/*.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "./tsconfig.json",
      },
    ],
  },
};

