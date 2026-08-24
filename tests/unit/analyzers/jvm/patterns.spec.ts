import type { FileInfo } from "../../../../src/core/types/file";
import { detectJvmPatterns } from "../../../../src/analyzers/jvm/detector";

function makeJavaFile(content: string, path = "Api.java"): FileInfo {
  return { path, name: path, content, language: "java", size: content.length };
}

function makeKotlinFile(content: string, path = "Api.kt"): FileInfo {
  return { path, name: path, content, language: "kotlin", size: content.length };
}

describe("JVM analyzer - Spring routes", () => {
  it("composes the class-level template with the method-level mapping", () => {
    const content = [
      "package com.acme;",
      "",
      "import org.springframework.web.bind.annotation.GetMapping;",
      "import org.springframework.web.bind.annotation.PostMapping;",
      "import org.springframework.web.bind.annotation.RequestMapping;",
      "import org.springframework.web.bind.annotation.RestController;",
      "",
      "@RestController",
      '@RequestMapping("/api/customers")',
      "public class CustomersController {",
      '    @GetMapping("/{id}")',
      "    public Customer byId(Long id) { return null; }",
      "",
      "    @PostMapping",
      "    public Customer create(Customer c) { return c; }",
      "}",
      "",
    ].join("\n");

    const routes = detectJvmPatterns(
      makeJavaFile(content, "CustomersController.java"),
    ).filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /api/customers/{id}",
      "POST /api/customers",
    ]);
    expect(routes[0].properties.framework).toBe("spring_mvc");
    expect(routes[0].properties.controller).toBe("CustomersController");
  });

  it("reads the verb from a method-level @RequestMapping argument", () => {
    const content = [
      "package com.acme;",
      "",
      "import org.springframework.web.bind.annotation.RequestMapping;",
      "import org.springframework.web.bind.annotation.RestController;",
      "",
      "@RestController",
      '@RequestMapping("/api/customers")',
      "public class CustomersController {",
      '    @RequestMapping(value = "/{id}", method = RequestMethod.DELETE)',
      "    public void remove(Long id) {}",
      "}",
      "",
    ].join("\n");

    const routes = detectJvmPatterns(
      makeJavaFile(content, "CustomersController.java"),
    ).filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name)).toEqual(["DELETE /api/customers/{id}"]);
    expect(routes[0].properties.httpMethods).toEqual(["DELETE"]);
  });

  it("combines a JAX-RS verb annotation with its sibling @Path", () => {
    const content = [
      "package com.acme;",
      "",
      "import jakarta.ws.rs.GET;",
      "import jakarta.ws.rs.Path;",
      "",
      '@Path("/customers")',
      "public class CustomerResource {",
      "    @GET",
      '    @Path("/{id}")',
      "    public Customer byId(Long id) { return null; }",
      "}",
      "",
    ].join("\n");

    const routes = detectJvmPatterns(
      makeJavaFile(content, "CustomerResource.java"),
    ).filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name)).toEqual(["GET /customers/{id}"]);
    expect(routes[0].properties.framework).toBe("jaxrs");
  });

  it("detects Ktor routing DSL registrations", () => {
    const content = [
      "package com.acme",
      "",
      "import io.ktor.server.routing.get",
      "import io.ktor.server.routing.routing",
      "",
      "fun Application.routes() {",
      "    routing {",
      '        get("/health") { call.respondText("ok") }',
      '        post("/api/invoices") { call.respondText("created") }',
      "    }",
      "}",
      "",
    ].join("\n");

    const routes = detectJvmPatterns(makeKotlinFile(content)).filter(
      (f) => f.pattern === "express_route",
    );

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "POST /api/invoices",
    ]);
  });
});

describe("JVM analyzer - databases", () => {
  it("resolves the engine from a JDBC URL sub-protocol", () => {
    const content = [
      "package com.acme;",
      "",
      "import com.zaxxer.hikari.HikariConfig;",
      "",
      "public class Db {",
      "    void configure(HikariConfig config) {",
      '        config.setJdbcUrl("jdbc:postgresql://db.internal:5432/billing");',
      "    }",
      "}",
      "",
    ].join("\n");

    const databases = detectJvmPatterns(makeJavaFile(content, "Db.java")).filter(
      (f) => f.pattern === "database_connection",
    );

    const jdbc = databases.find((f) => f.name === "jdbc:postgresql");
    expect(jdbc).toBeDefined();
    expect(jdbc?.properties.databaseType).toBe("postgres");
    expect(databases.map((f) => f.name)).toContain("hikaricp");
  });

  it("degrades an unknown JDBC driver rather than dropping it", () => {
    const content = [
      "package com.acme;",
      "",
      "public class Db {",
      '    String url = "jdbc:acmedb://host/db";',
      "}",
      "",
    ].join("\n");

    const jdbc = detectJvmPatterns(makeJavaFile(content, "Db.java")).find(
      (f) => f.name === "jdbc:acmedb",
    );

    expect(jdbc?.properties.databaseType).toBe("sql");
    expect(jdbc?.properties.driver).toBe("acmedb");
  });

  it("detects Spring Data JPA from a persistence annotation", () => {
    const content = [
      "package com.acme;",
      "",
      "import jakarta.persistence.Entity;",
      "",
      "@Entity",
      "public class Customer {",
      "}",
      "",
    ].join("\n");

    const databases = detectJvmPatterns(
      makeJavaFile(content, "Customer.java"),
    ).filter((f) => f.pattern === "database_connection");

    expect(databases.map((f) => f.name)).toContain("spring_data_jpa");
  });

  it("detects Exposed from Database.connect in Kotlin", () => {
    const content = [
      "package com.acme",
      "",
      "import org.jetbrains.exposed.sql.Database",
      "",
      "fun init() {",
      '    Database.connect("jdbc:postgresql://db/ledger", driver = "org.postgresql.Driver")',
      "}",
      "",
    ].join("\n");

    const databases = detectJvmPatterns(makeKotlinFile(content)).filter(
      (f) => f.pattern === "database_connection",
    );

    expect(databases.map((f) => f.name)).toContain("exposed");
  });
});

describe("JVM analyzer - external API calls", () => {
  it("attributes a RestTemplate call to its catalogued service", () => {
    const content = [
      "package com.acme;",
      "",
      "import org.springframework.web.client.RestTemplate;",
      "",
      "public class Charges {",
      "    void charge(RestTemplate restTemplate) {",
      '        restTemplate.postForObject("https://api.stripe.com/v1/charges", null, String.class);',
      "    }",
      "}",
      "",
    ].join("\n");

    const calls = detectJvmPatterns(makeJavaFile(content, "Charges.java")).filter(
      (f) => f.pattern === "external_api_call" && f.properties.url,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].properties.url).toBe("https://api.stripe.com/v1/charges");
    expect(calls[0].properties.serviceName).toBe("stripe");
  });

  it("does not read a Ktor server route as a Ktor client call", () => {
    const content = [
      "package com.acme",
      "",
      "import io.ktor.client.HttpClient",
      "import io.ktor.server.routing.get",
      "import io.ktor.server.routing.routing",
      "",
      "fun Application.routes() {",
      "    routing {",
      '        get("/health") { call.respondText("ok") }',
      "    }",
      "}",
      "",
      "suspend fun rates(client: HttpClient): String {",
      '    return client.get("https://api.exchangerate.host/latest").bodyAsText()',
      "}",
      "",
    ].join("\n");

    const findings = detectJvmPatterns(makeKotlinFile(content));

    const clientCalls = findings.filter(
      (f) => f.pattern === "external_api_call" && f.name === "ktor_client_call",
    );
    expect(clientCalls).toHaveLength(1);
    expect(clientCalls[0].properties.url).toBe(
      "https://api.exchangerate.host/latest",
    );

    // The `/health` registration is a route, and only a route.
    const routes = findings.filter((f) => f.pattern === "express_route");
    expect(routes.map((r) => r.name)).toContain("GET /health");
  });
});

describe("JVM analyzer - auth, env, and serverless", () => {
  it("detects Spring method security from an annotation", () => {
    const content = [
      "package com.acme;",
      "",
      "import org.springframework.security.access.prepost.PreAuthorize;",
      "",
      "public class Admin {",
      "    @PreAuthorize(\"hasRole('ADMIN')\")",
      "    public void purge() {}",
      "}",
      "",
    ].join("\n");

    const auth = detectJvmPatterns(makeJavaFile(content, "Admin.java")).filter(
      (f) => f.pattern === "auth_middleware",
    );

    const methodSecurity = auth.find(
      (f) => f.name === "spring_method_security",
    );
    expect(methodSecurity).toBeDefined();
    expect(methodSecurity?.properties.policy).toBe("hasRole('ADMIN')");
  });

  it("extracts env keys and Spring property placeholders", () => {
    const content = [
      "package com.acme;",
      "",
      "import org.springframework.beans.factory.annotation.Value;",
      "",
      "public class Settings {",
      '    @Value("${billing.rates.url}")',
      "    private String ratesUrl;",
      "",
      "    String key() {",
      '        return System.getenv("BILLING_API_KEY");',
      "    }",
      "}",
      "",
    ].join("\n");

    const findings = detectJvmPatterns(makeJavaFile(content, "Settings.java"));

    const env = findings.find((f) => f.pattern === "env_variable");
    expect(env?.properties.key).toBe("BILLING_API_KEY");

    const property = findings.find(
      (f) => f.pattern === "config_file" && f.name === "property(billing.rates.url)",
    );
    expect(property?.properties.key).toBe("billing.rates.url");
  });

  it("detects an AWS Lambda handler from its implemented interface", () => {
    const content = [
      "package com.acme;",
      "",
      "import com.amazonaws.services.lambda.runtime.Context;",
      "import com.amazonaws.services.lambda.runtime.RequestHandler;",
      "",
      "public class ChargeHandler implements RequestHandler<Event, String> {",
      "    public String handleRequest(Event event, Context context) {",
      '        return "ok";',
      "    }",
      "}",
      "",
    ].join("\n");

    const handlers = detectJvmPatterns(
      makeJavaFile(content, "ChargeHandler.java"),
    ).filter((f) => f.pattern === "lambda_handler");

    expect(handlers).toHaveLength(1);
    expect(handlers[0].name).toBe("aws_lambda_java ChargeHandler");
  });

  it("detects an Azure Functions handler from @FunctionName", () => {
    const content = [
      "package com.acme;",
      "",
      "import com.microsoft.azure.functions.annotation.FunctionName;",
      "",
      "public class Functions {",
      '    @FunctionName("chargeCustomer")',
      "    public String run(String payload) {",
      "        return payload;",
      "    }",
      "}",
      "",
    ].join("\n");

    const handlers = detectJvmPatterns(
      makeJavaFile(content, "Functions.java"),
    ).filter((f) => f.pattern === "lambda_handler");

    expect(handlers).toHaveLength(1);
    expect(handlers[0].properties.functionName).toBe("chargeCustomer");
  });
});
