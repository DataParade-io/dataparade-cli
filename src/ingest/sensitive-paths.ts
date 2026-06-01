/** True for `.env`, `.env.local`, `.env.production`, etc. */
export function isSensitiveEnvPath(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base === ".env" || base.startsWith(".env.");
}
