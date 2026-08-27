import {
  classifyIncludePath,
  expectedConeSparsePatterns,
  findMissingScopePaths,
  isLockStale,
  isMaterializationComplete,
  isSparseCheckoutSatisfied,
  lockFilePath,
  parseConeSparseCheckoutPatterns,
  planMaterializeConcurrency,
  readHeadSafely,
  requiredScopePaths,
  sparseConeDirectories,
  stagingDirectoryName,
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

  describe("readHeadSafely", () => {
    it("returns ok when HEAD is readable", () => {
      expect(readHeadSafely(() => "abc123\n")).toEqual({
        status: "ok",
        head: "abc123",
      });
    });

    it("returns error when HEAD read throws (partial clone race)", () => {
      expect(
        readHeadSafely(() => {
          throw new Error("fatal: not a git repository");
        }),
      ).toEqual({ status: "error" });
    });
  });

  describe("planMaterializeConcurrency", () => {
    const commit = "46acdb3290d677081e1b0889f3b736635a4e0847";

    it("uses a complete target without waiting", () => {
      expect(
        planMaterializeConcurrency({
          targetExists: true,
          headRead: { status: "ok", head: commit },
          materialization: { complete: true },
          lockHeldByPeer: false,
          lockStale: false,
        }),
      ).toBe("use-complete");
    });

    it("waits when a peer holds a fresh lock", () => {
      expect(
        planMaterializeConcurrency({
          targetExists: false,
          headRead: { status: "missing" },
          materialization: { complete: false },
          lockHeldByPeer: true,
          lockStale: false,
        }),
      ).toBe("wait-for-peer");
    });

    it("removes a partial target when HEAD is not available and no live lock is held", () => {
      expect(
        planMaterializeConcurrency({
          targetExists: true,
          headRead: { status: "error" },
          materialization: { complete: false },
          lockHeldByPeer: false,
          lockStale: false,
        }),
      ).toBe("remove-incomplete");
    });

    it("waits only when a peer holds a live fresh lock on a partial target", () => {
      expect(
        planMaterializeConcurrency({
          targetExists: true,
          headRead: { status: "error" },
          materialization: { complete: false },
          lockHeldByPeer: true,
          lockStale: false,
        }),
      ).toBe("wait-for-peer");
    });

    it("removes an incomplete target with a readable HEAD", () => {
      expect(
        planMaterializeConcurrency({
          targetExists: true,
          headRead: { status: "ok", head: "0000000000000000000000000000000000000000" },
          materialization: { complete: false },
          lockHeldByPeer: false,
          lockStale: false,
        }),
      ).toBe("remove-incomplete");
    });

    it("materializes into staging when no target exists", () => {
      expect(
        planMaterializeConcurrency({
          targetExists: false,
          headRead: { status: "missing" },
          materialization: { complete: false },
          lockHeldByPeer: false,
          lockStale: false,
        }),
      ).toBe("materialize-staging");
    });
  });

  describe("staging and lock helpers", () => {
    it("builds a unique staging directory beside the target", () => {
      expect(stagingDirectoryName("/cache/repos/foo@abc", "42-1")).toBe(
        "/cache/repos/foo@abc.staging-42-1",
      );
    });

    it("places the lock file beside the target directory", () => {
      expect(lockFilePath("/cache/repos/foo@abc")).toBe("/cache/repos/foo@abc.lock");
    });

    it("treats old locks as stale", () => {
      expect(isLockStale(16 * 60 * 1000, 15 * 60 * 1000)).toBe(true);
      expect(isLockStale(60 * 1000, 15 * 60 * 1000)).toBe(false);
    });
  });
});
