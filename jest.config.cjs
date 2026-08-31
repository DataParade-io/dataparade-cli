/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
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

