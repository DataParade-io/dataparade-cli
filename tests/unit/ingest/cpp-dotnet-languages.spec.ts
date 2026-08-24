import fs from "fs/promises";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest/file-system - C++ and C# language mapping", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-ingest-cpp-dotnet-"));

    const files: Record<string, string> = {
      "main.cpp": "int main() { return 0; }",
      "helper.cc": "void helper() {}",
      "service.cxx": "void service() {}",
      "types.hpp": "struct T {};",
      "legacy.h": "void legacy();",
      "Program.cs": "class Program {}",
      "View.cshtml": "@page",
      "Component.razor": "<div></div>",
      "notes.md": "# notes",
    };

    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(root, name), content, "utf8");
    }

    // Generated C# sources and .NET build output are excluded by default.
    await fs.writeFile(
      path.join(root, "Resources.Designer.cs"),
      "class Resources {}",
      "utf8",
    );
    await fs.mkdir(path.join(root, "obj"), { recursive: true });
    await fs.writeFile(
      path.join(root, "obj", "Generated.cs"),
      "class Generated {}",
      "utf8",
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("maps C++ and C# extensions to their languages", async () => {
    const files = await ingestFileSystem(root);
    const byPath = new Map(files.map((file) => [file.path, file.language]));

    expect(byPath.get("main.cpp")).toBe("cpp");
    expect(byPath.get("helper.cc")).toBe("cpp");
    expect(byPath.get("service.cxx")).toBe("cpp");
    expect(byPath.get("types.hpp")).toBe("cpp");
    expect(byPath.get("legacy.h")).toBe("cpp");

    expect(byPath.get("Program.cs")).toBe("csharp");
    expect(byPath.get("View.cshtml")).toBe("csharp");
    expect(byPath.get("Component.razor")).toBe("csharp");

    // Unsupported file types are still skipped.
    expect(byPath.has("notes.md")).toBe(false);
  });

  it("skips generated C# sources and .NET build output", async () => {
    const files = await ingestFileSystem(root);
    const paths = files.map((file) => file.path);

    expect(paths).not.toContain("Resources.Designer.cs");
    expect(paths.some((p) => p.startsWith("obj/"))).toBe(false);
  });
});
