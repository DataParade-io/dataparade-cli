import type { FileInfo } from "../../../../src/core/types/file";
import { detectCppPatterns } from "../../../../src/analyzers/cpp/detector";

function makeCppFile(content: string, path = "main.cpp"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "cpp",
    size: content.length,
  };
}

describe("C++ analyzer patterns", () => {
  it("detects Crow routes as express_route findings", () => {
    const content = [
      "#include <crow.h>",
      "",
      "int main() {",
      "  crow::SimpleApp app;",
      '  CROW_ROUTE(app, "/users")([](){ return "ok"; });',
      "  app.port(8080).run();",
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "server.cpp"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.length).toBe(1);
    expect(routes[0].properties.framework).toBe("crow");
    expect(routes[0].properties.path).toBe("/users");
    expect(routes[0].location.startLine).toBe(5);
  });

  it("detects cpp-httplib routes with their HTTP method", () => {
    const content = [
      '#include "httplib.h"',
      "",
      "int main() {",
      "  httplib::Server svr;",
      '  svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {});',
      '  svr.Post("/orders", [](const httplib::Request&, httplib::Response& res) {});',
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "api.cpp"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "POST /orders",
    ]);
  });

  it("detects libpqxx connections as database_connection findings", () => {
    const content = [
      "#include <pqxx/pqxx>",
      "",
      "void connect() {",
      '  pqxx::connection c("dbname=app");',
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "db.cpp"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.length).toBeGreaterThan(0);
    expect(dbs[0].properties.client).toBe("libpqxx");
    expect(dbs[0].properties.databaseType).toBe("postgres");
  });

  it("does not match a header on a partial path segment", () => {
    // <mysql/mysql.h> must not satisfy an `sql.h` style header rule.
    const content = ["#include <mysql/mysql.h>", ""].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "mysql.cpp"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.map((d) => d.properties.client)).toEqual([
      "mysql_connector_cpp",
    ]);
  });

  it("detects libcurl external calls and resolves the service from the URL", () => {
    const content = [
      "#include <curl/curl.h>",
      "",
      "void charge() {",
      "  CURL* curl = curl_easy_init();",
      '  curl_easy_setopt(curl, CURLOPT_URL, "https://api.stripe.com/v1/charges");',
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "payments.cpp"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    const stripeCall = apis.find(
      (f) => f.properties.url === "https://api.stripe.com/v1/charges",
    );
    expect(stripeCall).toBeDefined();
    expect(stripeCall?.properties.serviceName).toBe("stripe");
  });

  it("detects getenv usage as env_variable findings", () => {
    const content = [
      "#include <cstdlib>",
      "",
      "void init() {",
      '  const char* url = std::getenv("DATABASE_URL");',
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "init.cpp"));
    const envs = findings.filter((f) => f.pattern === "env_variable");

    expect(envs.length).toBe(1);
    expect(envs[0].properties.key).toBe("DATABASE_URL");
    expect(envs[0].location.startLine).toBe(4);
  });

  it("detects jwt-cpp usage as auth_middleware findings", () => {
    const content = [
      "#include <jwt-cpp/jwt.h>",
      "",
      "void verify(const std::string& token) {",
      "  auto decoded = jwt::decode(token);",
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "auth.cpp"));
    const auth = findings.filter(
      (f) => f.pattern === "auth_middleware" && f.name === "jwt_cpp",
    );

    expect(auth.length).toBe(1);
    expect(auth[0].properties.strategy).toBe("jwt");
  });

  it("ignores routes that only appear in comments", () => {
    const content = [
      "#include <crow.h>",
      "",
      "int main() {",
      '  // CROW_ROUTE(app, "/legacy")([](){ return "old"; });',
      "}",
      "",
    ].join("\n");

    const findings = detectCppPatterns(makeCppFile(content, "server.cpp"));

    expect(findings.filter((f) => f.pattern === "express_route")).toEqual([]);
  });

  it("returns no findings for a non-C++ file", () => {
    const file: FileInfo = {
      path: "app.py",
      name: "app.py",
      content: "import requests",
      language: "python",
      size: 15,
    };

    expect(detectCppPatterns(file)).toEqual([]);
  });
});
