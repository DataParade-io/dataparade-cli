export const FRONTEND_FRAMEWORK_HINTS = [
  "next_or_react_route",
  "nextjs",
  "react",
  "vue",
  "angular",
  "ionic",
  "electron",
  "svelte",
  "solid",
  "qwik",
] as const;

export const FRONTEND_FRAMEWORK_HINTS_SET = new Set<string>(
  FRONTEND_FRAMEWORK_HINTS,
);

export const PREFERRED_WEB_APP_FRAMEWORKS = new Set<string>([
  ...FRONTEND_FRAMEWORK_HINTS,
  "frontend",
]);

export const SERVER_FRAMEWORK_HINTS = new Set<string>([
  "nest",
  "express",
  "serverless",
]);
