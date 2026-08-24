import type { FileInfo } from "../../../../src/core/types/file";
import { parseCSharpCompilationUnit } from "../../../../src/analyzers/csharp/parser";

function createCSharpFile(
  content: string,
  path = "UsersController.cs",
): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "csharp",
    size: content.length,
  };
}

describe("C# parser - parseCSharpCompilationUnit", () => {
  it("indexes usings, namespace, types, attributes, methods, and calls", () => {
    const content = [
      "using System.Net.Http;",
      "using Microsoft.AspNetCore.Mvc;",
      "",
      "namespace Shop.Api.Controllers;",
      "",
      "[ApiController]",
      '[Route("api/[controller]")]',
      "public class UsersController : ControllerBase",
      "{",
      '    [HttpGet("{id}")]',
      "    public async Task<IActionResult> GetUser(int id)",
      "    {",
      '        var response = await _client.GetAsync("https://api.example.com/users");',
      "        return Ok();",
      "    }",
      "}",
      "",
    ].join("\n");

    const result = parseCSharpCompilationUnit(createCSharpFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.usings.map((u) => u.namespace)).toEqual([
      "System.Net.Http",
      "Microsoft.AspNetCore.Mvc",
    ]);
    expect(result.namespaceName).toBe("Shop.Api.Controllers");

    const controller = result.types.find((t) => t.name === "UsersController");
    expect(controller).toBeDefined();
    expect(controller?.baseTypes).toEqual(["ControllerBase"]);
    expect(controller?.attributes.map((a) => a.name)).toEqual([
      "ApiController",
      "Route",
    ]);
    expect(
      controller?.attributes.find((a) => a.name === "Route")?.argumentsSnippet,
    ).toBe('"api/[controller]"');

    const getUser = result.methods.find((m) => m.name === "GetUser");
    expect(getUser).toBeDefined();
    expect(getUser?.isAsync).toBe(true);
    expect(getUser?.declaringType).toBe("UsersController");
    expect(getUser?.attributes.map((a) => a.raw)).toEqual(['HttpGet("{id}")']);

    const call = result.calls.find((c) => c.callee === "_client.GetAsync");
    expect(call).toBeDefined();
    expect(call?.argumentsSnippet).toContain("https://api.example.com/users");
  });

  it("handles attributes that share a line with the member they decorate", () => {
    const content = [
      "using Microsoft.AspNetCore.Mvc;",
      "",
      "public class PingController : ControllerBase",
      "{",
      '    [HttpGet("ping")] public IActionResult Ping() => Ok();',
      "}",
      "",
    ].join("\n");

    const result = parseCSharpCompilationUnit(createCSharpFile(content));

    const ping = result.methods.find((m) => m.name === "Ping");
    expect(ping).toBeDefined();
    expect(ping?.attributes.map((a) => a.raw)).toEqual(['HttpGet("ping")']);
  });

  it("keeps verbatim strings intact and drops comments", () => {
    const content = [
      "using System;",
      "",
      "public class Config",
      "{",
      '    // var legacy = Environment.GetEnvironmentVariable("OLD_KEY");',
      '    public string Path = @"C:\\data\\app"; /* inline */',
      '    public string Url = "https://api.example.com/v1";',
      "}",
      "",
    ].join("\n");

    const result = parseCSharpCompilationUnit(createCSharpFile(content));

    expect(result.strippedContent).toContain("https://api.example.com/v1");
    expect(result.strippedContent).not.toContain("OLD_KEY");
    expect(result.strippedContent).not.toContain("inline");
    expect(result.strippedContent.split("\n").length).toBe(
      content.split("\n").length,
    );
  });

  it("records global and aliased usings", () => {
    const content = [
      "global using System.Text.Json;",
      "using Json = Newtonsoft.Json;",
      "using static System.Math;",
      "",
    ].join("\n");

    const result = parseCSharpCompilationUnit(createCSharpFile(content));

    expect(result.usings[0].isGlobal).toBe(true);
    expect(result.usings[0].namespace).toBe("System.Text.Json");
    expect(result.usings[1].namespace).toBe("Newtonsoft.Json");
    expect(result.usings[1].alias).toBe("Json");
    expect(result.usings[2].isStatic).toBe(true);
  });

  it("returns a warning and an empty model for non-C# files", () => {
    const file: FileInfo = {
      path: "main.cpp",
      name: "main.cpp",
      content: "#include <crow.h>",
      language: "cpp",
      size: 17,
    };

    const result = parseCSharpCompilationUnit(file);

    expect(result.usings).toEqual([]);
    expect(result.methods).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
