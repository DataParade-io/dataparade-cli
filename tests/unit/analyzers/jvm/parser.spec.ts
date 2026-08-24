import type { FileInfo } from "../../../../src/core/types/file";
import { parseJvmSourceFile } from "../../../../src/analyzers/jvm/parser";

function createJavaFile(content: string, path = "Service.java"): FileInfo {
  return { path, name: path, content, language: "java", size: content.length };
}

function createKotlinFile(content: string, path = "Service.kt"): FileInfo {
  return { path, name: path, content, language: "kotlin", size: content.length };
}

describe("JVM parser - Java", () => {
  it("indexes package, imports, annotated types, and methods", () => {
    const content = [
      "package com.acme.billing.web;",
      "",
      "import java.util.List;",
      "import static org.junit.Assert.assertEquals;",
      "import org.springframework.web.bind.annotation.*;",
      "",
      "@RestController",
      '@RequestMapping("/api/customers")',
      "public class CustomersController extends BaseController implements Auditable {",
      "",
      '    @GetMapping("/{id}")',
      "    public Customer byId(@PathVariable Long id) {",
      "        return repository.findById(id);",
      "    }",
      "}",
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createJavaFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.packageName).toBe("com.acme.billing.web");
    expect(result.isKotlin).toBe(false);

    expect(result.imports.map((i) => i.qualifiedName)).toEqual([
      "java.util.List",
      "org.junit.Assert.assertEquals",
      "org.springframework.web.bind.annotation",
    ]);
    expect(result.imports[1].isStatic).toBe(true);
    expect(result.imports[2].isWildcard).toBe(true);

    expect(result.types).toHaveLength(1);
    const type = result.types[0];
    expect(type.name).toBe("CustomersController");
    expect(type.kind).toBe("class");
    expect(type.baseTypes).toEqual(["BaseController", "Auditable"]);
    expect(type.annotations.map((a) => a.name).sort()).toEqual([
      "RequestMapping",
      "RestController",
    ]);
    expect(
      type.annotations.find((a) => a.name === "RequestMapping")?.argumentsSnippet,
    ).toBe('"/api/customers"');

    expect(result.methods.map((m) => m.name)).toEqual(["byId"]);
    expect(result.methods[0].declaringType).toBe("CustomersController");
    expect(result.methods[0].annotations[0].raw).toBe('GetMapping("/{id}")');
  });

  it("carries an annotation whose arguments wrap across lines", () => {
    const content = [
      "package com.acme;",
      "",
      "import org.springframework.web.bind.annotation.RequestMapping;",
      "",
      "public class Api {",
      "    @RequestMapping(",
      '        value = "/{id}",',
      "        method = RequestMethod.DELETE)",
      "    public void remove(Long id) {",
      "    }",
      "}",
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createJavaFile(content));

    expect(result.methods.map((m) => m.name)).toEqual(["remove"]);
    const annotation = result.methods[0].annotations[0];
    expect(annotation.name).toBe("RequestMapping");
    expect(annotation.argumentsSnippet).toContain('value = "/{id}"');
    expect(annotation.argumentsSnippet).toContain("RequestMethod.DELETE");
  });

  it("does not read statements or field initializers as method declarations", () => {
    const content = [
      "package com.acme;",
      "",
      "public class Api {",
      "    private final RestTemplate restTemplate = new RestTemplate();",
      "",
      "    void handle() {",
      "        return compute(1);",
      "    }",
      "}",
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createJavaFile(content));

    // `handle` is package-private with no modifier; `restTemplate` is a field
    // and `return compute(...)` is a statement.
    expect(result.methods.map((m) => m.name)).toEqual(["handle"]);
  });

  it("keeps URLs inside comments out of the stripped source", () => {
    const content = [
      "package com.acme;",
      "",
      "public class Api {",
      "    // see https://internal.example.com/runbook",
      '    String live = "https://api.stripe.com/v1/charges";',
      "}",
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createJavaFile(content));

    expect(result.strippedContent).not.toContain("internal.example.com");
    expect(result.strippedContent).toContain("api.stripe.com");
    // Comments are blanked, not removed, so line numbers stay accurate.
    expect(result.strippedContent.split("\n")).toHaveLength(
      content.split("\n").length,
    );
  });
});

describe("JVM parser - Kotlin", () => {
  it("indexes Kotlin declarations, supertypes, and aliased imports", () => {
    const content = [
      "package com.acme.ledger",
      "",
      "import io.ktor.server.routing.get",
      "import org.jetbrains.exposed.sql.Database as Db",
      "",
      "@Serializable",
      "data class Invoice(val id: Long) : Auditable, Comparable<Invoice> {",
      "    fun total(): Long = id",
      "}",
      "",
      "suspend fun fetchRates(client: HttpClient): String {",
      '    return client.get("https://api.exchangerate.host/latest")',
      "}",
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createKotlinFile(content));

    expect(result.warnings).toEqual([]);
    expect(result.isKotlin).toBe(true);
    expect(result.packageName).toBe("com.acme.ledger");

    const aliased = result.imports.find(
      (i) => i.qualifiedName === "org.jetbrains.exposed.sql.Database",
    );
    expect(aliased?.alias).toBe("Db");

    expect(result.types.map((t) => t.name)).toEqual(["Invoice"]);
    // The primary constructor's parameters must not be read as supertypes.
    expect(result.types[0].baseTypes).toEqual(["Auditable", "Comparable"]);
    expect(result.types[0].annotations.map((a) => a.name)).toEqual([
      "Serializable",
    ]);

    expect(result.methods.map((m) => m.name).sort()).toEqual([
      "fetchRates",
      "total",
    ]);
  });

  it("drops Kotlin use-site annotation targets", () => {
    const content = [
      "package com.acme",
      "",
      "class Config {",
      "    @field:Value(\"\\${db.url}\")",
      "    lateinit var dbUrl: String",
      "",
      "    @get:Secured",
      "    fun secret(): String = \"x\"",
      "}",
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createKotlinFile(content));

    const secret = result.methods.find((m) => m.name === "secret");
    expect(secret?.annotations.map((a) => a.name)).toEqual(["Secured"]);
  });

  it("handles nested block comments and raw strings", () => {
    const content = [
      "package com.acme",
      "",
      "/* outer /* inner */ still comment */",
      "val query = \"\"\"",
      "  SELECT * FROM customers",
      "\"\"\"",
      'val url = "https://api.stripe.com/v1"',
      "",
    ].join("\n");

    const result = parseJvmSourceFile(createKotlinFile(content));

    expect(result.strippedContent).not.toContain("still comment");
    expect(result.strippedContent).toContain("api.stripe.com");
  });
});

describe("JVM parser - guards", () => {
  it("warns and returns an empty model for a non-JVM language", () => {
    const file: FileInfo = {
      path: "main.go",
      name: "main.go",
      content: "package main",
      language: "go",
      size: 12,
    };

    const result = parseJvmSourceFile(file);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Unsupported language 'go'");
    expect(result.types).toEqual([]);
    expect(result.methods).toEqual([]);
  });
});
