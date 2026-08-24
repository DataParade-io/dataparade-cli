/**
 * Dependency extraction for JVM build manifests.
 *
 * Covers Maven (`pom.xml`), Gradle in both the Groovy and Kotlin DSLs
 * (`build.gradle`, `build.gradle.kts`), and Gradle version catalogs
 * (`gradle/libs.versions.toml`).
 *
 * All three normalize to a Maven coordinate — `groupId:artifactId`, version
 * dropped. Unlike Go, that token is *not* what appears in an `import`
 * statement (`org.springframework.boot:spring-boot-starter-data-jpa` versus
 * `org.springframework.data.jpa.repository`), which is why JVM rules carry
 * `packageCoordinates` separately from `importPackages`.
 */

import YAML from "yaml";

/**
 * Gradle configurations that put a dependency into the running application.
 *
 * Test configurations are absent by construction rather than filtered: they
 * are spelled `testImplementation`, `androidTestImplementation`, and so on,
 * so the capitalised infix means the `\b`-anchored lowercase names below
 * cannot match them. That keeps the test harness out of the service graph.
 */
const GRADLE_DEPENDENCY_CONFIGURATIONS = [
  "implementation",
  "api",
  "compileOnly",
  "compileOnlyApi",
  "runtimeOnly",
  "developmentOnly",
  "annotationProcessor",
  "kapt",
  "ksp",
  "classpath",
  "compile",
  "providedRuntime",
].join("|");

/** Wrappers a coordinate may sit inside: `implementation(platform("g:a:v"))`. */
const GRADLE_COORDINATE_WRAPPERS = "platform|enforcedPlatform|testFixtures";

function normalizeCoordinate(
  groupId: string | undefined,
  artifactId: string | undefined,
): string | null {
  const group = groupId?.trim();
  const artifact = artifactId?.trim();
  if (!group || !artifact) return null;

  // Reject unresolved Maven/Gradle property placeholders (`${spring.group}`).
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(group)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(artifact)) return null;

  return `${group}:${artifact}`;
}

function firstTagValue(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1];
}

/**
 * Maven `pom.xml`. The `<parent>` coordinate is included: on Spring Boot
 * projects it is `spring-boot-starter-parent`, which is often the clearest
 * statement of what the module is.
 */
export function extractCoordinatesFromPom(content: string): string[] {
  const coordinates = new Set<string>();

  const parentMatch = content.match(/<parent>([\s\S]*?)<\/parent>/);
  if (parentMatch) {
    const coordinate = normalizeCoordinate(
      firstTagValue(parentMatch[1], "groupId"),
      firstTagValue(parentMatch[1], "artifactId"),
    );
    if (coordinate) coordinates.add(coordinate);
  }

  const dependencyRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match: RegExpExecArray | null;

  while ((match = dependencyRegex.exec(content)) !== null) {
    const block = match[1];

    // Test-scoped dependencies describe the test harness, not the service.
    const scope = firstTagValue(block, "scope");
    if (scope && scope.trim().toLowerCase() === "test") continue;

    const coordinate = normalizeCoordinate(
      firstTagValue(block, "groupId"),
      firstTagValue(block, "artifactId"),
    );
    if (coordinate) coordinates.add(coordinate);
  }

  return Array.from(coordinates);
}

/**
 * Gradle build scripts, Groovy and Kotlin DSL alike:
 *
 *   implementation 'org.postgresql:postgresql:42.7.1'
 *   implementation("org.postgresql:postgresql:42.7.1")
 *   implementation group: 'org.postgresql', name: 'postgresql'
 *
 * Version-catalog references (`implementation(libs.spring.boot.web)`) carry no
 * coordinate here; they resolve from `gradle/libs.versions.toml` instead.
 */
export function extractCoordinatesFromGradle(content: string): string[] {
  const coordinates = new Set<string>();

  const stringNotation = new RegExp(
    `\\b(?:${GRADLE_DEPENDENCY_CONFIGURATIONS})\\s*\\(?\\s*(?:(?:${GRADLE_COORDINATE_WRAPPERS})\\s*\\(\\s*)?["']([^"']+)["']`,
    "g",
  );
  const mapNotation = new RegExp(
    `\\b(?:${GRADLE_DEPENDENCY_CONFIGURATIONS})\\s*\\(?\\s*group\\s*[:=]\\s*["']([^"']+)["']\\s*,\\s*name\\s*[:=]\\s*["']([^"']+)["']`,
    "g",
  );

  let match: RegExpExecArray | null;

  while ((match = mapNotation.exec(content)) !== null) {
    const coordinate = normalizeCoordinate(match[1], match[2]);
    if (coordinate) coordinates.add(coordinate);
  }

  while ((match = stringNotation.exec(content)) !== null) {
    const segments = match[1].split(":");
    if (segments.length < 2) continue;

    const coordinate = normalizeCoordinate(segments[0], segments[1]);
    if (coordinate) coordinates.add(coordinate);
  }

  return Array.from(coordinates);
}

/**
 * Gradle version catalog (`gradle/libs.versions.toml`), `[libraries]` section:
 *
 *   postgres = { module = "org.postgresql:postgresql", version.ref = "pg" }
 *   jedis    = { group = "redis.clients", name = "jedis" }
 */
export function extractCoordinatesFromVersionCatalog(
  content: string,
): string[] {
  const coordinates = new Set<string>();
  let inLibraries = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      inLibraries = line === "[libraries]";
      continue;
    }
    if (!inLibraries) continue;

    const moduleMatch = line.match(/\bmodule\s*=\s*"([^"]+)"/);
    if (moduleMatch) {
      const segments = moduleMatch[1].split(":");
      const coordinate = normalizeCoordinate(segments[0], segments[1]);
      if (coordinate) coordinates.add(coordinate);
      continue;
    }

    const groupMatch = line.match(/\bgroup\s*=\s*"([^"]+)"/);
    const nameMatch = line.match(/\bname\s*=\s*"([^"]+)"/);
    if (groupMatch && nameMatch) {
      const coordinate = normalizeCoordinate(groupMatch[1], nameMatch[1]);
      if (coordinate) coordinates.add(coordinate);
    }
  }

  return Array.from(coordinates);
}

export interface SpringDatasourceRef {
  /** Property key, e.g. `spring.datasource.url`. */
  key: string;
  /**
   * Engine token to resolve against the shared driver table: the JDBC/R2DBC
   * sub-protocol (`postgresql`) or a URI scheme (`mongodb`, `redis`).
   */
  driver: string;
}

const DATASOURCE_KEY_REGEX =
  /(^|\.)(url|uri|jdbc-url|jdbcUrl|contact-points|contactPoints|uris|host)$/;

/**
 * Read the engine out of a Spring datasource URI.
 *
 * Only the driver token is returned. These values routinely embed credentials
 * (`jdbc:postgresql://user:password@host/db`), so the URI itself never leaves
 * this function.
 */
export function driverTokenFromUri(value: string): string | undefined {
  const trimmed = value.trim();

  const jdbcMatch = trimmed.match(/^(?:jdbc|r2dbc):([a-z0-9]+):/i);
  if (jdbcMatch) return jdbcMatch[1].toLowerCase();

  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === "mongodb+srv") return "mongodb";
    return scheme;
  }

  return undefined;
}

/** `application.properties` — flat `key=value` lines. */
export function extractDatasourceRefsFromProperties(
  content: string,
): SpringDatasourceRef[] {
  const refs: SpringDatasourceRef[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;

    const separatorIndex = line.search(/[=:]/);
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || !value || !DATASOURCE_KEY_REGEX.test(key)) continue;

    const driver = driverTokenFromUri(value);
    if (driver) refs.push({ key, driver });
  }

  return refs;
}

function flattenYamlNode(
  node: unknown,
  prefix: string,
  out: Array<{ key: string; value: string }>,
): void {
  if (node === null || node === undefined) return;

  if (typeof node === "string") {
    if (prefix) out.push({ key: prefix, value: node });
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) flattenYamlNode(item, prefix, out);
    return;
  }

  if (typeof node === "object") {
    for (const [childKey, childValue] of Object.entries(
      node as Record<string, unknown>,
    )) {
      flattenYamlNode(
        childValue,
        prefix ? `${prefix}.${childKey}` : childKey,
        out,
      );
    }
  }
}

/**
 * `application.yml` — nested, and frequently multi-document, since Spring
 * separates per-profile configuration with `---`.
 */
export function extractDatasourceRefsFromYaml(
  content: string,
): SpringDatasourceRef[] {
  let documents: unknown[];
  try {
    documents = YAML.parseAllDocuments(content).map((doc) => doc.toJS());
  } catch {
    return [];
  }

  const refs: SpringDatasourceRef[] = [];
  const flattened: Array<{ key: string; value: string }> = [];

  for (const document of documents) {
    flattenYamlNode(document, "", flattened);
  }

  for (const entry of flattened) {
    if (!DATASOURCE_KEY_REGEX.test(entry.key)) continue;
    const driver = driverTokenFromUri(entry.value);
    if (driver) refs.push({ key: entry.key, driver });
  }

  return refs;
}
