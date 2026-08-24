import fs from "fs/promises";
import * as path from "path";

import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import { matchPatterns } from "../../patterns/engine";
import {
  type ManifestScanBudgetOptions,
  budgetStateFromOptions,
} from "../shared/manifest-budgets";
import { walkForManifests } from "../shared/manifest-fs";
import { loadJvmPatternConfig } from "./jvm-detection-config";
import {
  extractCoordinatesFromGradle,
  extractCoordinatesFromPom,
  extractCoordinatesFromVersionCatalog,
  extractDatasourceRefsFromProperties,
  extractDatasourceRefsFromYaml,
} from "./manifest-parsers";

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

export interface JvmManifestPackages {
  manifestRelativePath: string;
  /** Maven coordinates (`groupId:artifactId`), versions dropped. */
  packages: string[];
}

function createManifestFileInfo(manifestRelativePath: string): FileInfo {
  return {
    path: manifestRelativePath,
    name: path.basename(manifestRelativePath),
    content: "",
    language: "java",
    size: 0,
  };
}

export function isJvmBuildManifestName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "pom.xml" ||
    lower === "build.gradle" ||
    lower === "build.gradle.kts" ||
    lower === "libs.versions.toml"
  );
}

export function isSpringConfigName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    (lower.startsWith("application") || lower.startsWith("bootstrap")) &&
    (lower.endsWith(".properties") ||
      lower.endsWith(".yml") ||
      lower.endsWith(".yaml"))
  );
}

function extractCoordinates(manifestName: string, raw: string): string[] {
  const lower = manifestName.toLowerCase();

  if (lower === "pom.xml") return extractCoordinatesFromPom(raw);
  if (lower === "libs.versions.toml") {
    return extractCoordinatesFromVersionCatalog(raw);
  }
  return extractCoordinatesFromGradle(raw);
}

export async function parseJvmDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<JvmManifestPackages[]> {
  const rootDir = path.resolve(rootPath);
  const manifests: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, manifests, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      isJvmBuildManifestName(path.basename(entryPath)),
  });

  const byManifest: JvmManifestPackages[] = [];

  let bytesRead = 0;
  const maxBytes = state.maxTotalManifestReadBytes;

  for (const manifestAbsPath of manifests) {
    if (bytesRead >= maxBytes) break;

    const manifestName = path.basename(manifestAbsPath);
    const manifestRelativePath = toPosixPath(
      path.relative(rootDir, manifestAbsPath),
    );

    let raw: string;
    try {
      raw = await fs.readFile(manifestAbsPath, "utf8");
    } catch {
      continue;
    }
    bytesRead += raw.length;

    const packages = extractCoordinates(manifestName, raw);
    if (packages.length === 0) continue;

    byManifest.push({
      manifestRelativePath,
      packages: Array.from(new Set(packages)),
    });
  }

  return byManifest;
}

/**
 * Third-party and dependency detection from JVM build manifests, plus the
 * datasource URIs declared in `application.properties` / `application.yml` —
 * usually the only place a Spring service names the databases it talks to.
 */
export async function detectJvmPatternsFromDependencyManifests(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  const manifestPackages = await parseJvmDependencyManifests(rootPath, opts);
  for (const manifest of manifestPackages) {
    const manifestFile = createManifestFileInfo(manifest.manifestRelativePath);
    const imports = manifest.packages.map((coordinate) => {
      const [groupId, artifactId] = coordinate.split(":");
      const segments = groupId.split(".").filter(Boolean);
      return {
        module: coordinate,
        names: Array.from(
          new Set([coordinate, groupId, artifactId, ...segments]),
        ).filter(Boolean),
      };
    });

    findings.push(
      ...matchPatterns({
        language: "java",
        file: manifestFile,
        normalizedPath: manifestFile.path,
        imports,
      }),
    );
  }

  findings.push(...(await detectSpringDatasourceConfig(rootPath, opts)));

  return findings;
}

async function detectSpringDatasourceConfig(
  rootPath: string,
  opts?: ManifestScanBudgetOptions,
): Promise<RawFinding[]> {
  const rootDir = path.resolve(rootPath);
  const configFiles: string[] = [];

  const state = budgetStateFromOptions(opts);
  await walkForManifests(rootDir, configFiles, {
    rootDir,
    state,
    excludePaths: opts?.excludePaths,
    isManifestFile: (_entry, entryPath) =>
      isSpringConfigName(path.basename(entryPath)),
  });

  if (configFiles.length === 0) return [];

  const jdbcUrl = loadJvmPatternConfig().jdbcUrl;
  const findings: RawFinding[] = [];

  for (const absPath of configFiles) {
    const relativePath = toPosixPath(path.relative(rootDir, absPath));
    const name = path.basename(relativePath).toLowerCase();

    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf8");
    } catch {
      continue;
    }

    findings.push({
      pattern: "config_file",
      name: path.basename(relativePath),
      confidence: 0.9,
      location: { filePath: relativePath, startLine: 1, endLine: 1 },
      properties: {},
    });

    if (!jdbcUrl) continue;

    const refs = name.endsWith(".properties")
      ? extractDatasourceRefsFromProperties(raw)
      : extractDatasourceRefsFromYaml(raw);

    const seen = new Set<string>();
    for (const ref of refs) {
      if (seen.has(ref.driver)) continue;
      seen.add(ref.driver);

      findings.push({
        pattern: "database_connection",
        name: `${jdbcUrl.name}:${ref.driver}`,
        confidence: 0.85,
        location: { filePath: relativePath, startLine: 1, endLine: 1 },
        properties: {
          client: "spring_datasource",
          databaseType:
            jdbcUrl.drivers[ref.driver] ?? jdbcUrl.defaultDatabaseType,
          driver: ref.driver,
          key: ref.key,
        },
      });
    }
  }

  return findings;
}
