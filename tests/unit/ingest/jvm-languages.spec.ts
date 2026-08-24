import fs from "fs/promises";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest/file-system - Java and Kotlin language mapping", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-ingest-jvm-"));

    const files: Record<string, string> = {
      "Application.java": "class Application {}",
      "Routes.kt": "fun routes() {}",
      "build.gradle.kts": "plugins { }",
      "notes.md": "# notes",
    };

    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(root, name), content, "utf8");
    }

    // Maven and Gradle build output is excluded by default.
    await fs.mkdir(path.join(root, "target", "classes"), { recursive: true });
    await fs.writeFile(
      path.join(root, "target", "classes", "Generated.java"),
      "class Generated {}",
      "utf8",
    );
    await fs.mkdir(path.join(root, ".gradle"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".gradle", "Cached.kt"),
      "fun cached() {}",
      "utf8",
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("maps .java to java and .kt/.kts to kotlin", async () => {
    const files = await ingestFileSystem(root);
    const byName = new Map(files.map((file) => [file.name, file.language]));

    expect(byName.get("Application.java")).toBe("java");
    expect(byName.get("Routes.kt")).toBe("kotlin");
    expect(byName.get("build.gradle.kts")).toBe("kotlin");
    expect(byName.has("notes.md")).toBe(false);
  });

  it("excludes Maven and Gradle build output", async () => {
    const files = await ingestFileSystem(root);
    const names = files.map((file) => file.name);

    // `target/` is excluded by name; `.gradle/` as a hidden directory.
    expect(names).not.toContain("Generated.java");
    expect(names).not.toContain("Cached.kt");
  });
});
