import type { FileInfo } from "../../../../src/core/types/file";
import { detectGoPatterns } from "../../../../src/analyzers/go/detector";

function makeGoFile(content: string, path = "main.go"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "go",
    size: content.length,
  };
}

describe("Go analyzer patterns", () => {
  it("detects gin routes with their HTTP method", () => {
    const content = [
      "package main",
      "",
      'import "github.com/gin-gonic/gin"',
      "",
      "func main() {",
      "\tr := gin.Default()",
      '\tr.GET("/customers", listCustomers)',
      '\tr.POST("/charges", createCharge)',
      '\tr.Run(":8080")',
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "server.go"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /customers",
      "POST /charges",
    ]);
    expect(routes[0].properties.framework).toBe("gin");
  });

  it("detects Go 1.22 method-prefixed net/http patterns", () => {
    const content = [
      "package main",
      "",
      'import "net/http"',
      "",
      "func main() {",
      "\tmux := http.NewServeMux()",
      '\tmux.HandleFunc("GET /health", healthHandler)',
      '\tmux.HandleFunc("/legacy", legacyHandler)',
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "server.go"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "NET_HTTP_ROUTE /legacy",
    ]);
  });

  it("attributes a gorilla/mux route to one framework, not two", () => {
    const content = [
      "package main",
      "",
      "import (",
      '\t"net/http"',
      "",
      '\t"github.com/gorilla/mux"',
      ")",
      "",
      "func main() {",
      "\tr := mux.NewRouter()",
      '\tr.HandleFunc("/orders", ordersHandler).Methods("POST")',
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "server.go"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    // net/http is imported too, but its rule yields lines ending in .Methods().
    expect(routes.length).toBe(1);
    expect(routes[0].name).toBe("POST /orders");
    expect(routes[0].properties.framework).toBe("gorilla_mux");
  });

  it("resolves the engine from the sql.Open driver argument", () => {
    const content = [
      "package main",
      "",
      "import (",
      '\t"database/sql"',
      "",
      '\t_ "github.com/lib/pq"',
      ")",
      "",
      "func open() {",
      '\tdb, _ := sql.Open("postgres", dsn)',
      "\t_ = db",
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "db.go"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    const sqlOpen = dbs.find((d) => d.properties.client === "database_sql");
    expect(sqlOpen).toBeDefined();
    expect(sqlOpen?.properties.driver).toBe("postgres");
    expect(sqlOpen?.properties.databaseType).toBe("postgres");

    // The blank driver import is its own signal.
    expect(dbs.map((d) => d.properties.client)).toContain("lib_pq");
  });

  it("falls back to a generic sql databaseType for unknown drivers", () => {
    const content = [
      "package main",
      "",
      'import "database/sql"',
      "",
      "func open() {",
      '\tdb, _ := sql.Open("exotic-driver", dsn)',
      "\t_ = db",
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "db.go"));
    const sqlOpen = findings.find(
      (f) => f.properties.client === "database_sql",
    );

    expect(sqlOpen?.properties.driver).toBe("exotic-driver");
    expect(sqlOpen?.properties.databaseType).toBe("sql");
  });

  it("detects http.Get calls and resolves the third-party service", () => {
    const content = [
      "package main",
      "",
      'import "net/http"',
      "",
      "func charge() {",
      '\tresp, _ := http.Get("https://api.stripe.com/v1/charges")',
      "\tdefer resp.Body.Close()",
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "charge.go"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    const stripeCall = apis.find(
      (f) => f.properties.url === "https://api.stripe.com/v1/charges",
    );
    expect(stripeCall).toBeDefined();
    expect(stripeCall?.properties.serviceName).toBe("stripe");
  });

  it("does not treat a chi router .Get() as an outbound HTTP call", () => {
    const content = [
      "package main",
      "",
      "import (",
      '\t"net/http"',
      "",
      '\t"github.com/go-chi/chi/v5"',
      ")",
      "",
      "func main() {",
      "\tr := chi.NewRouter()",
      '\tr.Get("/items", itemsHandler)',
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "server.go"));

    const routes = findings.filter((f) => f.pattern === "express_route");
    expect(routes.map((r) => r.name)).toEqual(["GET /items"]);

    // r.Get is a route registration, not an outbound call.
    expect(findings.filter((f) => f.pattern === "external_api_call")).toEqual(
      [],
    );
  });

  it("detects os.Getenv keys as env_variable findings", () => {
    const content = [
      "package main",
      "",
      'import "os"',
      "",
      "func config() {",
      '\turl := os.Getenv("DATABASE_URL")',
      '\tkey, _ := os.LookupEnv("API_KEY")',
      "\t_, _ = url, key",
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "config.go"));
    const envs = findings.filter((f) => f.pattern === "env_variable");

    expect(envs.map((e) => e.properties.key).sort()).toEqual([
      "API_KEY",
      "DATABASE_URL",
    ]);
  });

  it("detects jwt usage as auth_middleware findings", () => {
    const content = [
      "package auth",
      "",
      'import "github.com/golang-jwt/jwt/v5"',
      "",
      "func verify(token string) error {",
      "\t_, err := jwt.Parse(token, nil)",
      "\treturn err",
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "auth.go"));
    const auth = findings.filter(
      (f) => f.pattern === "auth_middleware" && f.name === "golang_jwt",
    );

    expect(auth.length).toBe(1);
    expect(auth[0].properties.strategy).toBe("jwt");
  });

  it("detects AWS Lambda handlers as lambda_handler findings", () => {
    const content = [
      "package main",
      "",
      'import "github.com/aws/aws-lambda-go/lambda"',
      "",
      "func main() {",
      "\tlambda.Start(handleRequest)",
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "main.go"));
    const handlers = findings.filter((f) => f.pattern === "lambda_handler");

    expect(handlers.length).toBe(1);
    expect(handlers[0].properties.framework).toBe("aws_lambda_go");
  });

  it("ignores routes that only appear in comments", () => {
    const content = [
      "package main",
      "",
      'import "github.com/gin-gonic/gin"',
      "",
      "func main() {",
      "\tr := gin.Default()",
      '\t// r.GET("/legacy", legacyHandler)',
      "}",
      "",
    ].join("\n");

    const findings = detectGoPatterns(makeGoFile(content, "server.go"));

    expect(findings.filter((f) => f.pattern === "express_route")).toEqual([]);
  });

  it("returns no findings for a non-Go file", () => {
    const file: FileInfo = {
      path: "app.py",
      name: "app.py",
      content: "import requests",
      language: "python",
      size: 15,
    };

    expect(detectGoPatterns(file)).toEqual([]);
  });
});
