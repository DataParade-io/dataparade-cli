import type { FileInfo } from "../../../../src/core/types/file";
import { parseGoSourceFile } from "../../../../src/analyzers/go/parser";

function createGoFile(content: string, path = "main.go"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "go",
    size: content.length,
  };
}

describe("Go parser - parseGoSourceFile", () => {
  it("indexes package, grouped imports, functions, types, and calls", () => {
    const content = [
      "package main",
      "",
      "import (",
      '\t"database/sql"',
      '\t"net/http"',
      "",
      '\tmux "github.com/gorilla/mux"',
      '\t_ "github.com/lib/pq"',
      ")",
      "",
      "type Server struct {",
      "\tdb *sql.DB",
      "}",
      "",
      "func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {",
      '\tresp, _ := http.Get("https://api.example.com/items")',
      "\tdefer resp.Body.Close()",
      "}",
      "",
      "func NewServer() *Server {",
      "\treturn &Server{}",
      "}",
      "",
    ].join("\n");

    const result = parseGoSourceFile(createGoFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.packageName).toBe("main");

    expect(result.imports.map((i) => i.path)).toEqual([
      "database/sql",
      "net/http",
      "github.com/gorilla/mux",
      "github.com/lib/pq",
    ]);

    const gorilla = result.imports.find(
      (i) => i.path === "github.com/gorilla/mux",
    );
    expect(gorilla?.alias).toBe("mux");

    const pq = result.imports.find((i) => i.path === "github.com/lib/pq");
    expect(pq?.isBlank).toBe(true);
    expect(pq?.alias).toBeUndefined();

    const server = result.types.find((t) => t.name === "Server");
    expect(server?.kind).toBe("struct");

    const handle = result.functions.find((fn) => fn.name === "Handle");
    expect(handle?.receiverType).toBe("Server");
    const newServer = result.functions.find((fn) => fn.name === "NewServer");
    expect(newServer?.receiverType).toBeUndefined();

    const httpGet = result.calls.find((c) => c.callee === "http.Get");
    expect(httpGet).toBeDefined();
    expect(httpGet?.argumentsSnippet).toContain(
      "https://api.example.com/items",
    );
  });

  it("indexes single-line and aliased imports", () => {
    const content = [
      "package api",
      "",
      'import "fmt"',
      'import alias "github.com/acme/lib"',
      "",
    ].join("\n");

    const result = parseGoSourceFile(createGoFile(content, "api.go"));

    expect(result.imports.map((i) => i.path)).toEqual([
      "fmt",
      "github.com/acme/lib",
    ]);
    expect(result.imports[1].alias).toBe("alias");
  });

  it("blanks comments while preserving backtick raw strings and layout", () => {
    const content = [
      "package main",
      "",
      '// resp, _ := http.Get("https://old.example.com")',
      "/* block",
      "   comment */",
      "const query = `SELECT * FROM users -- not a comment`",
      'const url = "https://api.example.com/v1" // trailing',
      "",
    ].join("\n");

    const result = parseGoSourceFile(createGoFile(content));

    expect(result.strippedContent).toContain("SELECT * FROM users");
    expect(result.strippedContent).toContain("https://api.example.com/v1");
    expect(result.strippedContent).not.toContain("old.example.com");
    expect(result.strippedContent).not.toContain("trailing");
    expect(result.strippedContent.split("\n").length).toBe(
      content.split("\n").length,
    );
  });

  it("returns a warning and an empty model for non-Go files", () => {
    const file: FileInfo = {
      path: "main.cpp",
      name: "main.cpp",
      content: "#include <crow.h>",
      language: "cpp",
      size: 17,
    };

    const result = parseGoSourceFile(file);

    expect(result.imports).toEqual([]);
    expect(result.functions).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
