import fs from "fs/promises";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest/file-system - PHP language mapping", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-ingest-php-"));

    const files: Record<string, string> = {
      "index.php": "<?php echo 'ok';",
      "view.phtml": "<?= $title ?>",
      "notes.md": "# notes",
    };

    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(root, name), content, "utf8");
    }

    await fs.mkdir(path.join(root, "vendor", "guzzlehttp"), { recursive: true });
    await fs.writeFile(
      path.join(root, "vendor", "guzzlehttp", "Client.php"),
      "<?php class Client {}",
      "utf8",
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("maps .php and .phtml to php", async () => {
    const files = await ingestFileSystem(root);
    const byName = new Map(files.map((file) => [file.name, file.language]));

    expect(byName.get("index.php")).toBe("php");
    expect(byName.get("view.phtml")).toBe("php");
    expect(byName.has("notes.md")).toBe(false);
  });

  it("excludes Composer vendor/ by default", async () => {
    const files = await ingestFileSystem(root);
    const names = files.map((file) => file.name);

    expect(names).not.toContain("Client.php");
  });
});
