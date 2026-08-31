import type { FileInfo } from "../../../../src/core/types/file";
import { detectPhpPatterns } from "../../../../src/analyzers/php/detector";

function makePhpFile(content: string, path = "index.php"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "php",
    size: content.length,
  };
}

describe("PHP analyzer patterns", () => {
  it("detects Laravel routes with their HTTP method", () => {
    const content = [
      "<?php",
      "",
      "Route::get('/customers', [CustomerController::class, 'index']);",
      "Route::post('/charges', [ChargeController::class, 'store']);",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "routes/web.php"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /customers",
      "POST /charges",
    ]);
    expect(routes[0].properties.framework).toBe("laravel");
  });

  it("detects Slim routes when Slim is imported", () => {
    const content = [
      "<?php",
      "",
      "use Slim\\App;",
      "",
      "$app->get('/health', $healthHandler);",
      "$app->post('/orders', $createOrder);",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "app.php"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "POST /orders",
    ]);
    expect(routes[0].properties.framework).toBe("slim");
  });

  it("resolves the engine from a PDO DSN", () => {
    const content = [
      "<?php",
      "",
      '$db = new PDO("pgsql:host=localhost;dbname=app", $user, $pass);',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "db.php"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    const pdoDsn = dbs.find((d) => d.properties.client === "pdo_dsn");
    expect(pdoDsn).toBeDefined();
    expect(pdoDsn?.properties.driver).toBe("pgsql");
    expect(pdoDsn?.properties.databaseType).toBe("postgres");
  });

  it("detects Guzzle external API calls with a URL", () => {
    const content = [
      "<?php",
      "",
      "use GuzzleHttp\\Client;",
      "",
      "$client = new Client();",
      '$response = $client->get("https://api.stripe.com/v1/charges");',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "billing.php"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    expect(apis.length).toBeGreaterThan(0);
    expect(
      apis.some((a) => String(a.properties.url ?? "").includes("stripe.com")),
    ).toBe(true);
  });

  it("detects env() and getenv variable reads", () => {
    const content = [
      "<?php",
      "",
      '$key = getenv("APP_KEY");',
      '$db = env("DB_CONNECTION");',
      '$fromEnv = $_ENV["STRIPE_SECRET"];',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "config.php"));
    const envs = findings.filter((f) => f.pattern === "env_variable");

    expect(envs.map((e) => e.properties.key).sort()).toEqual([
      "APP_KEY",
      "DB_CONNECTION",
      "STRIPE_SECRET",
    ]);
  });

  it("detects Sanctum auth from a use import", () => {
    const content = [
      "<?php",
      "",
      "use Laravel\\Sanctum\\HasApiTokens;",
      "",
      "class User",
      "{",
      "    use HasApiTokens;",
      "}",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "User.php"));
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.map((a) => a.name)).toContain("laravel_sanctum");
  });

  it("detects Symfony attribute routes", () => {
    const content = [
      "<?php",
      "",
      '#[Route("/api/users", methods: ["GET"])]',
      "class UsersController",
      "{",
      "}",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "UsersController.php"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name)).toContain("SYMFONY_ROUTE /api/users");
    expect(routes[0].properties.framework).toBe("symfony");
  });

  it("detects Symfony docblock @Route annotations", () => {
    const content = [
      "<?php",
      "",
      "/**",
      " * @Route(\"/legacy\")",
      " */",
      "class LegacyController",
      "{",
      "}",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "LegacyController.php"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name)).toContain("SYMFONY_ROUTE /legacy");
    expect(routes[0].properties.framework).toBe("symfony");
  });

  it("does not treat Guzzle new Client() as Predis", () => {
    const content = [
      "<?php",
      "",
      "use GuzzleHttp\\Client;",
      "",
      "$client = new Client();",
      '$response = $client->get("https://api.stripe.com/v1/charges");',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "billing.php"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.map((d) => d.name)).not.toContain("predis");
  });

  it("detects Predis when Predis is imported", () => {
    const content = [
      "<?php",
      "",
      "use Predis\\Client;",
      "",
      "$redis = new Client();",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "cache.php"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.map((d) => d.name)).toContain("predis");
  });

  it("resolves the engine from a fully-qualified new \\PDO DSN", () => {
    const content = [
      "<?php",
      "",
      '$db = new \\PDO("pgsql:host=localhost;dbname=app", $user, $pass);',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "db.php"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    const pdoDsn = dbs.find((d) => d.properties.client === "pdo_dsn");
    expect(pdoDsn).toBeDefined();
    expect(pdoDsn?.properties.driver).toBe("pgsql");
    expect(pdoDsn?.properties.databaseType).toBe("postgres");
  });

  it("detects mysqli with a leading backslash", () => {
    const content = [
      "<?php",
      "",
      '$db = new \\mysqli("localhost", "user", "pass", "app");',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "db.php"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.map((d) => d.name)).toContain("mysqli");
  });

  it("detects Guzzle calls when imported via grouped use", () => {
    const content = [
      "<?php",
      "",
      "use GuzzleHttp\\{Client};",
      "",
      "$client = new Client();",
      '$response = $client->get("https://api.stripe.com/v1/charges");',
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "billing.php"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    expect(apis.length).toBeGreaterThan(0);
    expect(
      apis.some((a) => String(a.properties.url ?? "").includes("stripe.com")),
    ).toBe(true);
  });

  it("detects Slim routes when imported via grouped use", () => {
    const content = [
      "<?php",
      "",
      "use Slim\\{App};",
      "",
      "$app->get('/health', $healthHandler);",
      "$app->post('/orders', $createOrder);",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "app.php"));
    const routes = findings.filter((f) => f.pattern === "express_route");

    expect(routes.map((r) => r.name).sort()).toEqual([
      "GET /health",
      "POST /orders",
    ]);
    expect(routes[0].properties.framework).toBe("slim");
  });

  it("detects Laravel config() helper as config_file", () => {
    const content = ["<?php", "", '$name = config("app.name");', ""].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "settings.php"));
    const configs = findings.filter((f) => f.pattern === "config_file");

    expect(configs.map((c) => c.name)).toContain("laravel_config");
  });

  it("detects Guzzle when the URL is on the line after ->get", () => {
    const content = [
      "<?php",
      "",
      "use GuzzleHttp\\Client;",
      "",
      "$client = new Client();",
      "$response = $client->get(",
      '    "https://api.stripe.com/v1/charges"',
      ");",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "billing.php"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    expect(apis.length).toBeGreaterThan(0);
    expect(
      apis.some((a) => String(a.properties.url ?? "").includes("stripe.com")),
    ).toBe(true);
  });

  it("emits a single curl finding for init/setopt/exec with one URL", () => {
    const content = [
      "<?php",
      "",
      "$ch = curl_init();",
      'curl_setopt($ch, CURLOPT_URL, "https://api.example.com/v1");',
      "curl_exec($ch);",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "http.php"));
    const curls = findings.filter(
      (f) =>
        f.pattern === "external_api_call" &&
        String(f.name).startsWith("curl"),
    );

    expect(curls).toHaveLength(1);
    expect(String(curls[0].properties.url ?? "")).toContain("api.example.com");
  });

  it("detects Eloquent via Eloquent:: method calls when imported", () => {
    const content = [
      "<?php",
      "",
      "use Illuminate\\Database\\Eloquent\\Model;",
      "",
      "Eloquent::unguard();",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "model.php"));
    const dbs = findings.filter((f) => f.pattern === "database_connection");

    expect(dbs.map((d) => d.name)).toContain("eloquent");
  });

  it("detects Laravel Socialite as oauth2 auth_middleware", () => {
    const content = [
      "<?php",
      "",
      "use Laravel\\Socialite\\Facades\\Socialite;",
      "",
      "return Socialite::driver('google')->redirect();",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "oauth.php"));
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.map((a) => a.name)).toContain("laravel_socialite");
    expect(auth.find((a) => a.name === "laravel_socialite")?.properties.strategy).toBe(
      "oauth2",
    );
  });

  it("detects league/oauth2-client as oauth2 auth_middleware", () => {
    const content = [
      "<?php",
      "",
      "use League\\OAuth2\\Client\\Provider\\GenericProvider;",
      "",
      "$provider = new GenericProvider([]);",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "oidc.php"));
    const auth = findings.filter((f) => f.pattern === "auth_middleware");

    expect(auth.map((a) => a.name)).toContain("league_oauth2_client");
    expect(
      auth.find((a) => a.name === "league_oauth2_client")?.properties.strategy,
    ).toBe("oauth2");
  });

  it("detects AWS S3 from Aws\\S3 import presence", () => {
    const content = [
      "<?php",
      "",
      "use Aws\\S3\\S3Client;",
      "",
      "$client = new S3Client([]);",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "storage.php"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    expect(
      apis.some(
        (a) =>
          a.properties.serviceName === "aws" ||
          a.properties.client === "aws_s3",
      ),
    ).toBe(true);
  });

  it("detects AWS S3 from league/flysystem-aws-s3-v3 package import", () => {
    const content = [
      "<?php",
      "",
      "use League\\Flysystem\\AwsS3V3\\AwsS3V3Adapter;",
      "",
      "$adapter = new AwsS3V3Adapter($client, 'bucket');",
      "",
    ].join("\n");

    const findings = detectPhpPatterns(makePhpFile(content, "flysystem.php"));
    const apis = findings.filter((f) => f.pattern === "external_api_call");

    expect(
      apis.some(
        (a) =>
          a.properties.serviceName === "aws" ||
          a.properties.client === "aws_s3",
      ),
    ).toBe(true);
  });
});
