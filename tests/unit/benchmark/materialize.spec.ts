import {
  classifyIncludePath,
  expectedConeSparsePatterns,
  findMissingScopePaths,
  isMaterializationComplete,
  isSparseCheckoutSatisfied,
  parseConeSparseCheckoutPatterns,
  requiredScopePaths,
  sparseConeDirectories,
} from "../../benchmark/materialize-paths";

describe("materialize path helpers", () => {
  describe("classifyIncludePath", () => {
    it("classifies trailing-slash paths as directories", () => {
      expect(classifyIncludePath("app/")).toEqual({
        original: "app/",
        kind: "directory",
        normalized: "app",
      });
    });

    it("classifies bare directory names as directories", () => {
      expect(classifyIncludePath("students")).toEqual({
        original: "students",
        kind: "directory",
        normalized: "students",
      });
    });

    it("classifies file paths as files", () => {
      expect(classifyIncludePath("idVerification/settings.py")).toEqual({
        original: "idVerification/settings.py",
        kind: "file",
        normalized: "idVerification/settings.py",
      });
    });
  });

  describe("sparseConeDirectories", () => {
    it("returns directory paths unchanged", () => {
      expect(sparseConeDirectories(["app/", "idVerification/"])).toEqual([
        "app",
        "idVerification",
      ]);
    });

    it("maps file paths to parent directories for cone sparse checkout", () => {
      expect(sparseConeDirectories(["app/", "idVerification/settings.py"])).toEqual([
        "app",
        "idVerification",
      ]);
    });

    it("rejects root-level file paths", () => {
      expect(() => sparseConeDirectories(["manage.py"])).toThrow(
        /cannot be used with cone sparse checkout/,
      );
    });
  });

  describe("requiredScopePaths", () => {
    it("preserves original include kinds for validation", () => {
      expect(requiredScopePaths(["app/", "idVerification/settings.py"])).toEqual([
        { path: "app", kind: "directory" },
        { path: "idVerification/settings.py", kind: "file" },
      ]);
    });
  });

  describe("sparse checkout parsing", () => {
    const conePatterns = `/*
!/*/
/app/
/idVerification/
`;

    it("parses cone sparse-checkout patterns", () => {
      expect(parseConeSparseCheckoutPatterns(conePatterns)).toEqual(
        new Set(["/app", "/idVerification"]),
      );
    });

    it("builds expected patterns from include directories", () => {
      expect(expectedConeSparsePatterns(["app", "idVerification"])).toEqual(
        new Set(["/app", "/idVerification"]),
      );
    });

    it("validates sparse checkout against include scope", () => {
      expect(
        isSparseCheckoutSatisfied(conePatterns, ["app/", "idVerification/"]),
      ).toBe(true);
      expect(
        isSparseCheckoutSatisfied(conePatterns, ["app/", "idVerification/settings.py"]),
      ).toBe(true);
      expect(isSparseCheckoutSatisfied(conePatterns, ["students/"])).toBe(false);
    });
  });

  describe("findMissingScopePaths", () => {
    const exists = (relativePath: string) =>
      ["app", "idVerification/settings.py"].includes(relativePath);
    const isDirectory = (relativePath: string) => relativePath === "app";

    it("reports missing files and directories", () => {
      expect(
        findMissingScopePaths(["app/", "idVerification/settings.py"], exists, isDirectory),
      ).toEqual([]);
      expect(
        findMissingScopePaths(["app/", "missing/"], exists, isDirectory),
      ).toEqual(["missing"]);
      expect(
        findMissingScopePaths(["idVerification/settings.py"], exists, isDirectory),
      ).toEqual([]);
    });

    it("flags directory entries that resolve to files", () => {
      expect(
        findMissingScopePaths(
          ["idVerification/settings.py"],
          () => true,
          () => true,
        ),
      ).toEqual(["idVerification/settings.py"]);
    });
  });

  describe("isMaterializationComplete", () => {
    const conePatterns = `/*
!/*/
/app/
/idVerification/
`;

    const baseCheck = {
      head: "46acdb3290d677081e1b0889f3b736635a4e0847",
      commit: "46acdb3290d677081e1b0889f3b736635a4e0847",
      includePaths: ["app/", "idVerification/"],
      exists: (relativePath: string) => ["app", "idVerification"].includes(relativePath),
      isDirectory: () => true,
      sparseCheckoutContent: conePatterns,
    };

    it("accepts a complete materialization", () => {
      expect(isMaterializationComplete(baseCheck)).toEqual({ complete: true });
    });

    it("rejects commit mismatches", () => {
      expect(
        isMaterializationComplete({
          ...baseCheck,
          head: "0000000000000000000000000000000000000000",
        }),
      ).toEqual({ complete: false, reason: "commit mismatch" });
    });

    it("rejects missing scope paths", () => {
      expect(
        isMaterializationComplete({
          ...baseCheck,
          exists: () => false,
        }),
      ).toEqual({
        complete: false,
        reason: "missing scope paths: app, idVerification",
      });
    });

    it("rejects incomplete sparse checkout configuration", () => {
      expect(
        isMaterializationComplete({
          ...baseCheck,
          sparseCheckoutContent: "/*\n!/*/\n",
        }),
      ).toEqual({
        complete: false,
        reason: "sparse checkout patterns incomplete",
      });
    });

    it("rejects absent sparse checkout when scope is non-empty", () => {
      expect(
        isMaterializationComplete({
          ...baseCheck,
          sparseCheckoutContent: null,
        }),
      ).toEqual({
        complete: false,
        reason: "sparse checkout not configured",
      });
    });
  });
});
