import path from "path";

import {
  detectJvmPatternsFromDependencyManifests,
  parseJvmDependencyManifests,
} from "../../../../src/analyzers/jvm/dependency-manifests";
import {
  driverTokenFromUri,
  extractCoordinatesFromGradle,
  extractCoordinatesFromPom,
  extractCoordinatesFromVersionCatalog,
  extractDatasourceRefsFromProperties,
  extractDatasourceRefsFromYaml,
} from "../../../../src/analyzers/jvm/manifest-parsers";

function fixturePath(name: string): string {
  return path.join(__dirname, "..", "..", "..", "fixtures", name);
}

describe("JVM manifest parsers - Maven", () => {
  it("reads dependency and parent coordinates, skipping test scope", () => {
    const pom = [
      "<project>",
      "  <parent>",
      "    <groupId>org.springframework.boot</groupId>",
      "    <artifactId>spring-boot-starter-parent</artifactId>",
      "  </parent>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.postgresql</groupId>",
      "      <artifactId>postgresql</artifactId>",
      "    </dependency>",
      "    <dependency>",
      "      <groupId>org.springframework.boot</groupId>",
      "      <artifactId>spring-boot-starter-test</artifactId>",
      "      <scope>test</scope>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ].join("\n");

    expect(extractCoordinatesFromPom(pom).sort()).toEqual([
      "org.postgresql:postgresql",
      "org.springframework.boot:spring-boot-starter-parent",
    ]);
  });

  it("rejects unresolved property placeholders", () => {
    const pom = [
      "<project><dependencies><dependency>",
      "  <groupId>${spring.group}</groupId>",
      "  <artifactId>${spring.artifact}</artifactId>",
      "</dependency></dependencies></project>",
    ].join("\n");

    expect(extractCoordinatesFromPom(pom)).toEqual([]);
  });
});

describe("JVM manifest parsers - Gradle", () => {
  it("reads both DSL forms and unwraps platform() declarations", () => {
    const gradle = [
      "dependencies {",
      '    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.2.0"))',
      '    implementation("org.springframework.boot:spring-boot-starter-web")',
      "    implementation 'redis.clients:jedis:5.1.0'",
      "    runtimeOnly group: 'org.postgresql', name: 'postgresql'",
      "}",
    ].join("\n");

    expect(extractCoordinatesFromGradle(gradle).sort()).toEqual([
      "org.postgresql:postgresql",
      "org.springframework.boot:spring-boot-dependencies",
      "org.springframework.boot:spring-boot-starter-web",
      "redis.clients:jedis",
    ]);
  });

  it("leaves test dependencies and non-dependency strings out", () => {
    const gradle = [
      "plugins {",
      '    kotlin("jvm") version "1.9.22"',
      "}",
      "repositories {",
      '    maven { url "https://repo.example.com/releases" }',
      "}",
      "dependencies {",
      '    implementation("com.zaxxer:HikariCP:5.1.0")',
      '    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")',
      "}",
    ].join("\n");

    expect(extractCoordinatesFromGradle(gradle)).toEqual([
      "com.zaxxer:HikariCP",
    ]);
  });

  it("reads a Gradle version catalog", () => {
    const toml = [
      "[versions]",
      'postgres = "42.7.1"',
      "",
      "[libraries]",
      'postgres = { module = "org.postgresql:postgresql", version.ref = "postgres" }',
      'jedis = { group = "redis.clients", name = "jedis" }',
      "",
      "[plugins]",
      'spring = { id = "org.springframework.boot", version = "3.2.0" }',
    ].join("\n");

    expect(extractCoordinatesFromVersionCatalog(toml).sort()).toEqual([
      "org.postgresql:postgresql",
      "redis.clients:jedis",
    ]);
  });
});

describe("JVM manifest parsers - Spring datasource configuration", () => {
  it("reads the driver token out of a URI without keeping the URI", () => {
    expect(driverTokenFromUri("jdbc:postgresql://host:5432/db")).toBe(
      "postgresql",
    );
    expect(driverTokenFromUri("r2dbc:mysql://host/db")).toBe("mysql");
    expect(driverTokenFromUri("mongodb+srv://cluster/db")).toBe("mongodb");
    expect(driverTokenFromUri("not-a-uri")).toBeUndefined();
  });

  it("extracts datasource keys from application.properties", () => {
    const properties = [
      "# billing service",
      "spring.datasource.url=jdbc:postgresql://db.internal:5432/billing",
      "spring.datasource.password=super-secret-value",
      "spring.data.mongodb.uri=mongodb://mongo.internal:27017/events",
      "server.port=8080",
    ].join("\n");

    expect(extractDatasourceRefsFromProperties(properties)).toEqual([
      { key: "spring.datasource.url", driver: "postgresql" },
      { key: "spring.data.mongodb.uri", driver: "mongodb" },
    ]);
  });

  it("extracts datasource keys from every document of an application.yml", () => {
    const yaml = [
      "spring:",
      "  datasource:",
      "    url: jdbc:postgresql://db.internal:5432/billing",
      "---",
      "spring:",
      "  config:",
      "    activate:",
      "      on-profile: local",
      "  datasource:",
      "    url: jdbc:h2:mem:testdb",
    ].join("\n");

    expect(extractDatasourceRefsFromYaml(yaml)).toEqual([
      { key: "spring.datasource.url", driver: "postgresql" },
      { key: "spring.datasource.url", driver: "h2" },
    ]);
  });
});

describe("JVM dependency manifest scanning", () => {
  it("collects coordinates from every build file in the tree", async () => {
    const manifests = await parseJvmDependencyManifests(
      fixturePath("jvm-manifests-basic"),
    );

    const byPath = new Map(
      manifests.map((m) => [m.manifestRelativePath, m.packages]),
    );

    expect(byPath.get("pom.xml")?.sort()).toEqual([
      "org.postgresql:postgresql",
      "org.springframework.boot:spring-boot-starter-data-jpa",
      "org.springframework.boot:spring-boot-starter-parent",
      "redis.clients:jedis",
    ]);

    expect(byPath.get("services/ledger/build.gradle.kts")?.sort()).toEqual([
      "com.mysql:mysql-connector-j",
      "com.zaxxer:HikariCP",
      "org.springframework.boot:spring-boot-dependencies",
      "org.springframework.boot:spring-boot-starter-web",
    ]);
  });

  it("maps coordinates and datasource URIs onto findings", async () => {
    const findings = await detectJvmPatternsFromDependencyManifests(
      fixturePath("jvm-manifests-basic"),
    );

    const databases = findings.filter(
      (f) => f.pattern === "database_connection",
    );
    const names = databases.map((f) => f.name);

    // From pom.xml coordinates.
    expect(names).toContain("postgresql_jdbc");
    expect(names).toContain("spring_data_jpa");
    expect(names).toContain("jedis");
    // From build.gradle.kts coordinates.
    expect(names).toContain("mysql_jdbc");
    expect(names).toContain("hikaricp");
    // From application.yml datasource URIs.
    expect(names).toContain("jdbc:postgresql");
    expect(names).toContain("jdbc:mongodb");

    const mongo = databases.find((f) => f.name === "jdbc:mongodb");
    expect(mongo?.properties.databaseType).toBe("mongodb");
    expect(mongo?.properties.key).toBe("spring.data.mongodb.uri");

    expect(
      findings.some(
        (f) => f.pattern === "config_file" && f.name === "application.yml",
      ),
    ).toBe(true);
  });

  it("never carries a datasource password into a finding", async () => {
    const findings = await detectJvmPatternsFromDependencyManifests(
      fixturePath("jvm-manifests-basic"),
    );

    expect(JSON.stringify(findings)).not.toContain("super-secret-value");
  });
});
