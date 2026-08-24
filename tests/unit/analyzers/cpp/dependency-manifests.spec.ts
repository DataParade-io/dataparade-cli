import path from "path";

import {
  detectCppPatternsFromDependencyManifests,
  parseCppDependencyManifests,
} from "../../../../src/analyzers/cpp/dependency-manifests";
import {
  extractPackagesFromCMakeLists,
  extractPackagesFromConanfile,
  extractPackagesFromVcpkgJson,
} from "../../../../src/analyzers/cpp/manifest-parsers";

const FIXTURE_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "fixtures",
  "cpp-dependency-manifests-basic",
);

describe("C++ manifest parsers", () => {
  it("extracts vcpkg dependencies in both string and object form", () => {
    const content = JSON.stringify({
      name: "app",
      dependencies: ["libpqxx", { name: "hiredis", "version>=": "1.1.0" }],
    });

    expect(extractPackagesFromVcpkgJson(content).sort()).toEqual([
      "hiredis",
      "libpqxx",
    ]);
  });

  it("returns nothing for malformed vcpkg manifests", () => {
    expect(extractPackagesFromVcpkgJson("{ not json")).toEqual([]);
  });

  it("extracts Conan requires from txt and py recipes, stripping versions", () => {
    const txt = ["[requires]", "fmt/10.2.1", "", "[generators]", "CMakeDeps"].join(
      "\n",
    );
    expect(extractPackagesFromConanfile(txt)).toEqual(["fmt"]);

    const py = [
      "class AppConan(ConanFile):",
      "    def requirements(self):",
      '        self.requires("zlib/1.3")',
      "",
    ].join("\n");
    expect(extractPackagesFromConanfile(py)).toEqual(["zlib"]);
  });

  it("extracts CMake find_package and FetchContent declarations", () => {
    const content = [
      "find_package(SQLite3 REQUIRED)",
      "FetchContent_Declare(cpr GIT_REPOSITORY https://github.com/libcpr/cpr.git)",
      "",
    ].join("\n");

    expect(extractPackagesFromCMakeLists(content).sort()).toEqual([
      "cpr",
      "sqlite3",
    ]);
  });
});

describe("C++ dependency manifest scanning", () => {
  it("collects packages from every manifest kind in a repository", async () => {
    const manifests = await parseCppDependencyManifests(FIXTURE_ROOT);
    const byName = new Map(
      manifests.map((m) => [m.manifestRelativePath, m.packages]),
    );

    expect(byName.get("vcpkg.json")).toEqual(
      expect.arrayContaining(["libpqxx", "curl", "hiredis"]),
    );
    expect(byName.get("conanfile.txt")).toEqual(
      expect.arrayContaining(["sentry-native", "aws-sdk-cpp"]),
    );
    expect(byName.get("CMakeLists.txt")).toEqual(
      expect.arrayContaining(["sqlite3"]),
    );
  });

  it("maps manifest packages to third-party services and databases", async () => {
    const findings = await detectCppPatternsFromDependencyManifests(
      FIXTURE_ROOT,
    );

    const serviceNames = findings
      .filter((f) => f.pattern === "external_api_call")
      .map((f) => f.properties.serviceName);
    expect(serviceNames).toEqual(expect.arrayContaining(["sentry", "aws"]));

    const databases = findings
      .filter((f) => f.pattern === "database_connection")
      .map((f) => f.properties.client);
    expect(databases).toEqual(
      expect.arrayContaining(["libpqxx", "hiredis", "sqlite3"]),
    );
  });
});
