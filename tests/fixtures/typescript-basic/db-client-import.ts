import "./pg-client";

export function ensurePgClientLoaded(): void {
  // This module exists so the TypeScript analyzer sees a module import containing
  // \"pg\" and can emit a database_connection finding for tests.
}

