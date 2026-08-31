import type { FileInfo } from "../../../../src/core/types/file";
import { parsePhpSourceFile } from "../../../../src/analyzers/php/parser";

function createPhpFile(content: string, path = "index.php"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "php",
    size: content.length,
  };
}

describe("PHP parser - parsePhpSourceFile", () => {
  it("indexes namespace, use imports, classes, functions, and calls", () => {
    const content = [
      "<?php",
      "",
      "namespace App\\Http;",
      "",
      "use GuzzleHttp\\Client;",
      "use Illuminate\\Support\\Facades\\DB as Database;",
      "require_once 'vendor/autoload.php';",
      "",
      "class OrdersController",
      "{",
      "    public function index()",
      "    {",
      '        $client = new Client();',
      '        $client->get("https://api.example.com/items");',
      "        return Database::table('orders')->get();",
      "    }",
      "}",
      "",
      "function boot()",
      "{",
      '    getenv("APP_KEY");',
      "}",
      "",
    ].join("\n");

    const result = parsePhpSourceFile(createPhpFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.namespace).toBe("App\\Http");

    expect(result.imports.map((i) => i.path)).toEqual([
      "GuzzleHttp\\Client",
      "Illuminate\\Support\\Facades\\DB",
      "vendor/autoload.php",
    ]);

    const guzzle = result.imports.find((i) => i.path === "GuzzleHttp\\Client");
    expect(guzzle?.isRequire).toBe(false);

    const db = result.imports.find(
      (i) => i.path === "Illuminate\\Support\\Facades\\DB",
    );
    expect(db?.alias).toBe("Database");

    const require = result.imports.find((i) => i.path === "vendor/autoload.php");
    expect(require?.isRequire).toBe(true);

    const controller = result.types.find((t) => t.name === "OrdersController");
    expect(controller?.kind).toBe("class");

    const index = result.functions.find((fn) => fn.name === "index");
    expect(index?.className).toBe("OrdersController");

    const boot = result.functions.find((fn) => fn.name === "boot");
    expect(boot?.className).toBeUndefined();

    expect(result.calls.some((c) => c.callee === "new Client")).toBe(true);
    expect(result.calls.some((c) => c.callee === "->get")).toBe(true);
    expect(result.calls.some((c) => c.callee === "Database::table")).toBe(true);
    expect(result.calls.some((c) => c.callee === "getenv")).toBe(true);
  });

  it("blanks comments while preserving string literals and layout", () => {
    const content = [
      "<?php",
      '// $client->get("https://old.example.com");',
      "# ignored hash comment",
      '/* $client->get("https://block.example.com"); */',
      '$client->get("https://live.example.com");',
      "",
    ].join("\n");

    const result = parsePhpSourceFile(createPhpFile(content));

    expect(result.strippedContent).not.toContain("old.example.com");
    expect(result.strippedContent).not.toContain("block.example.com");
    expect(result.strippedContent).toContain("https://live.example.com");
    expect(result.calls.some((c) => c.callee === "->get")).toBe(true);
  });

  it("preserves PHP 8 attributes when stripping hash comments", () => {
    const content = [
      "<?php",
      "",
      '#[Route("/api/users", methods: ["GET"])]',
      "class UsersController",
      "{",
      "}",
      "",
    ].join("\n");

    const result = parsePhpSourceFile(createPhpFile(content));
    expect(result.strippedContent).toContain('#[Route("/api/users"');
  });

  it("expands grouped use imports into full paths", () => {
    const content = [
      "<?php",
      "",
      "use GuzzleHttp\\{Client, HandlerStack};",
      "use Slim\\{App as SlimApp, Routing\\RouteCollector};",
      "use function App\\Helpers\\{format, slugify as toSlug};",
      "",
    ].join("\n");

    const result = parsePhpSourceFile(createPhpFile(content));

    expect(result.imports.map((i) => i.path)).toEqual([
      "GuzzleHttp\\Client",
      "GuzzleHttp\\HandlerStack",
      "Slim\\App",
      "Slim\\Routing\\RouteCollector",
      "App\\Helpers\\format",
      "App\\Helpers\\slugify",
    ]);

    const slimApp = result.imports.find((i) => i.path === "Slim\\App");
    expect(slimApp?.alias).toBe("SlimApp");

    const slugify = result.imports.find((i) => i.path === "App\\Helpers\\slugify");
    expect(slugify?.alias).toBe("toSlug");
  });

  it("returns a warning for non-php language", () => {
    const file: FileInfo = {
      path: "main.go",
      name: "main.go",
      content: "package main",
      language: "go",
      size: 12,
    };

    const result = parsePhpSourceFile(file);
    expect(result.warnings.length).toBe(1);
    expect(result.imports).toEqual([]);
  });
});
