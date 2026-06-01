export const NON_RUNTIME_METADATA_FILE_NAMES = new Set(["package.json"]);

export const NON_RUNTIME_METADATA_EXTENSIONS = [
  ".lock",
  ".yaml",
  ".yml",
  ".toml",
];

export const FRONTEND_RUNTIME_PATH_MARKERS = [
  "/components/",
  "/hooks/",
  "/pages/",
  "/app/",
];

export const FRONTEND_RUNTIME_FILE_EXTENSIONS = [".tsx", ".jsx"];

export const ROUTE_HANDLER_PATH_MARKERS = [
  "/app/api/",
  "/routers/",
  "/routes/",
  "/controller",
  "/controllers/",
  "/views/",
  "/endpoints/",
];

export const ROUTE_HANDLER_FILE_SUFFIXES = [
  "/route.ts",
  "/route.js",
  "/route.py",
  "/server.ts",
  "/server.js",
  "/server.py",
  "/router.py",
  "/routes.py",
  "/views.py",
  "/main.py",
  "/app.py",
];
