import type { FileInfo } from "../../../../src/core/types/file";
import { parseCppTranslationUnit } from "../../../../src/analyzers/cpp/parser";

function createCppFile(content: string, path = "main.cpp"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "cpp",
    size: content.length,
  };
}

describe("C++ parser - parseCppTranslationUnit", () => {
  it("indexes includes, functions, types, and calls", () => {
    const content = [
      "#include <curl/curl.h>",
      '#include "handlers/users.h"',
      "",
      "namespace api {",
      "",
      "class UserService : public BaseService {",
      "public:",
      "  void Load() {",
      "    CURL* curl = curl_easy_init();",
      '    curl_easy_setopt(curl, CURLOPT_URL, "https://api.example.com/users");',
      "  }",
      "};",
      "",
      "}",
      "",
    ].join("\n");

    const result = parseCppTranslationUnit(createCppFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.includes.map((i) => i.header)).toEqual([
      "curl/curl.h",
      "handlers/users.h",
    ]);
    expect(result.includes[0].isSystem).toBe(true);
    expect(result.includes[1].isSystem).toBe(false);

    expect(result.namespaces).toContain("api");

    const userService = result.types.find((t) => t.name === "UserService");
    expect(userService).toBeDefined();
    expect(userService?.kind).toBe("class");
    expect(userService?.baseTypes).toEqual(["BaseService"]);

    expect(result.functions.map((fn) => fn.name)).toContain("Load");

    const setopt = result.calls.find((c) => c.callee === "curl_easy_setopt");
    expect(setopt).toBeDefined();
    expect(setopt?.argumentsSnippet).toContain("https://api.example.com/users");
    expect(setopt?.location.startLine).toBe(10);
  });

  it("blanks comments without destroying URLs inside string literals", () => {
    const content = [
      "// #include <sqlite3.h>",
      "/* block comment",
      "   spanning lines */",
      '#include "app.h"',
      'const char* endpoint = "https://api.example.com/v1"; // trailing comment',
      "",
    ].join("\n");

    const result = parseCppTranslationUnit(createCppFile(content));

    expect(result.includes.map((i) => i.header)).toEqual(["app.h"]);
    expect(result.strippedContent).toContain("https://api.example.com/v1");
    expect(result.strippedContent).not.toContain("trailing comment");
    // Comment blanking preserves line numbering.
    expect(result.strippedContent.split("\n").length).toBe(
      content.split("\n").length,
    );
  });

  it("returns a warning and an empty model for non-C++ files", () => {
    const file: FileInfo = {
      path: "app.py",
      name: "app.py",
      content: "import os",
      language: "python",
      size: 9,
    };

    const result = parseCppTranslationUnit(file);

    expect(result.includes).toEqual([]);
    expect(result.calls).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
