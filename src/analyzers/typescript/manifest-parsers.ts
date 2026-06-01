function normalizePackageName(name: string): string | null {
  const s = name.trim();
  if (!s) return null;
  const beforeAt = s.includes("@") && !s.startsWith("@") ? s.split("@")[0] : s;
  const token = beforeAt.toLowerCase();
  return token || null;
}

export function extractPackagesFromPackageJsonObject(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object") return [];

  const obj = parsed as Record<string, unknown>;
  const collect = (value: unknown): string[] => {
    if (!value || typeof value !== "object") return [];
    const deps = value as Record<string, unknown>;
    return Object.keys(deps)
      .map((k) => normalizePackageName(k))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  };

  const packages = [
    ...collect(obj.dependencies),
    ...collect(obj.devDependencies),
    ...collect(obj.optionalDependencies),
  ];

  return Array.from(new Set(packages));
}

