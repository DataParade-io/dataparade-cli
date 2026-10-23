import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  describeScanTree,
  estimateScanFootprint,
  LARGE_TREE_FILE_COUNT,
  summarizeScanTree,
} from "../../../src/platform-api/estimate-scan-footprint";

async function write(root: string, rel: string, content = "x"): Promise<void> {
  await fs.promises.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.promises.writeFile(path.join(root, rel), content);
}

describe("estimateScanFootprint", () => {
  it("counts files and bytes under scan root", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dp-footprint-"),
    );
    await fs.promises.writeFile(path.join(root, "a.ts"), "hello");
    await fs.promises.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.promises.writeFile(
      path.join(root, "node_modules", "skip.js"),
      "ignored",
    );

    const footprint = await estimateScanFootprint(root);

    expect(footprint.fileCount).toBeGreaterThanOrEqual(1);
    expect(footprint.bytesIngested).toBeGreaterThanOrEqual(5);
  });

  it("counts files and folders without entering excluded or ignored ones", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dp-tree-"));
    try {
      await write(root, ".gitignore", "generated/\n");
      await write(root, "app/api/users/route.ts");
      await write(root, "app/page.tsx");
      await write(root, "lib/db.ts");
      await write(root, "lib/db.test.ts");
      await write(root, "docs/guide/a.json");
      for (const skipped of [
        "node_modules/pkg/index.js",
        ".next/server/chunk.js",
        ".git/HEAD",
        "dist/index.js",
        "build/index.js",
        "coverage/lcov.info",
        "generated/prisma/index.js",
      ]) {
        await write(root, skipped);
      }
      const readdir = jest.spyOn(fs.promises, "readdir");
      let summary;
      try {
        summary = await summarizeScanTree(root, ["docs/**"]);
        const visited = readdir.mock.calls.map(([dir]) => path.relative(root, String(dir)));
        for (const pruned of ["node_modules", ".next", ".git", "dist", "build", "coverage", "generated", "docs"]) {
          expect(visited).not.toContain(pruned);
        }
      } finally {
        readdir.mockRestore();
      }

      // route.ts, page.tsx, db.ts and the 11-byte .gitignore; db.test.ts is a default exclude.
      expect(summary).toEqual({
        fileCount: 4,
        directoryCount: 4,
        bytes: 14,
        capped: false,
        topLevelFolders: [
          { name: "app", fileCount: 2, bytes: 2 },
          { name: "lib", fileCount: 1, bytes: 1 },
        ],
      });
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("warns about a large tree and names its biggest folders", () => {
    const small = describeScanTree({
      fileCount: 352,
      directoryCount: 40,
      bytes: 2 * 1024 * 1024,
      capped: false,
      topLevelFolders: [{ name: "lib", fileCount: 352, bytes: 2 * 1024 * 1024 }],
    });
    expect(small).toEqual({ line: "Scanning 352 files in 40 folders (2 MB)." });

    const large = describeScanTree({
      fileCount: LARGE_TREE_FILE_COUNT + 1,
      directoryCount: 3_000,
      bytes: 150 * 1024 * 1024,
      capped: false,
      topLevelFolders: [
        { name: "public", fileCount: 12_000, bytes: 1 },
        { name: "messages", fileCount: 5_000, bytes: 1 },
        { name: "app", fileCount: 2_000, bytes: 1 },
        { name: "lib", fileCount: 1_001, bytes: 1 },
      ],
    });
    expect(large.line).toBe("Scanning 20,001 files in 3,000 folders (150 MB).");
    expect(large.warning).toContain("public/ (12,000 files), messages/ (5,000 files), app/ (2,000 files)");
    expect(large.warning).toContain("--exclude 'public/**' 'messages/**' 'app/**'");
  });
});
