import type { FileInfo } from "../../../../src/core/types/file";
import { parsePythonModule } from "../../../../src/analyzers/python/parser";

function createPythonFile(content: string, path = "app.py"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "python",
    size: content.length,
  };
}

describe("Python parser - parsePythonModule", () => {
  it("indexes imports, functions, and module-level calls from a basic module", () => {
    const content = [
      "import requests",
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
      "def ping():",
      "    return 'pong'",
      "",
      "@app.get('/items/{item_id}')",
      "async def read_item(item_id: int):",
      "    response = requests.get('https://example.com/items')",
      "    return {'item_id': item_id, 'status': response.status_code}",
      "",
    ].join("\n");

    const file = createPythonFile(content);
    const result = parsePythonModule(file);

    expect(result.warnings).toEqual([]);
    expect(result.imports.length).toBe(2);
    expect(result.functions.length).toBe(2);
    expect(result.moduleLevelCalls.length).toBeGreaterThanOrEqual(1);

    const pingFn = result.functions.find((fn) => fn.name === "ping");
    const readItemFn = result.functions.find((fn) => fn.name === "read_item");

    expect(pingFn).toBeDefined();
    expect(pingFn?.isAsync).toBe(false);
    expect(pingFn?.decorators).toEqual([]);

    expect(readItemFn).toBeDefined();
    expect(readItemFn?.isAsync).toBe(true);
    expect(readItemFn?.decorators).toEqual(["app.get"]);
  });

  it("treats non-python languages as a non-fatal warning", () => {
    const file: FileInfo = {
      path: "app.ts",
      name: "app.ts",
      content: "console.log('hello');",
      language: "typescript",
      size: 25,
    };

    const result = parsePythonModule(file);

    expect(result.imports).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.moduleLevelCalls).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns warnings-only behavior for malformed python function signatures", () => {
    const content = [
      "def broken_function:",
      "    return 1",
      "",
      "async def also_broken",
      "    return 2",
      "",
    ].join("\n");

    const result = parsePythonModule(createPythonFile(content, "malformed.py"));

    expect(result.imports).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.moduleLevelCalls).toEqual([]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.join(" ")).toContain(
      "Potentially malformed function signature",
    );
  });

  it("treats unreadable-like python content as non-fatal warning", () => {
    const content = "\u0000\u0000import requests\u0000";

    const result = parsePythonModule(createPythonFile(content, "unreadable.py"));

    expect(result.imports).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.moduleLevelCalls).toEqual([]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.join(" ")).toContain("appears unreadable");
  });

  it("extracts valid constructs while warning on malformed signatures", () => {
    const content = [
      "import requests",
      "",
      "def ok_function():",
      "    return requests.get('https://example.com/health').status_code",
      "",
      "def broken_function:",
      "    return 1",
      "",
      "bootstrap()",
      "",
    ].join("\n");

    const result = parsePythonModule(createPythonFile(content, "mixed.py"));

    expect(result.imports).toHaveLength(1);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("ok_function");
    expect(result.moduleLevelCalls.map((call) => call.callee)).toContain(
      "bootstrap",
    );
    expect(result.warnings.join(" ")).toContain(
      "Potentially malformed function signature",
    );
  });
});

