import type { FileInfo } from "../../../../src/core/types/file";
import { detectPythonPatterns } from "../../../../src/analyzers/python/detector";

function makePythonFile(content: string, path = "app.py"): FileInfo {
  return {
    path,
    name: path,
    content,
    language: "python",
    size: content.length,
  };
}

describe("Python analyzer patterns - DP-P0-CLI-703", () => {
  it("detects FastAPI route handlers as express_route findings", () => {
    const content = [
      "from fastapi import FastAPI",
      "",
      "app = FastAPI()",
      "",
      "@app.get('/items/{item_id}')",
      "async def read_item(item_id: int):",
      "    return {'item_id': item_id}",
      "",
    ].join("\n");

    const file = makePythonFile(content, "fastapi_app.py");
    const findings = detectPythonPatterns(file);

    const routeFindings = findings.filter(
      (f) => f.pattern === "express_route",
    );

    expect(routeFindings.length).toBeGreaterThan(0);
    const first = routeFindings[0];
    expect(first.name).toContain("GET");
    expect(first.properties.framework).toBe("fastapi");
    // FastAPI detection should capture the route path when available.
    expect(first.properties.path).toBe("/items/{item_id}");
  });

  it("detects psycopg2 connections as database_connection findings", () => {
    const content = [
      "import psycopg2",
      "",
      "conn = psycopg2.connect(dsn='postgres://example')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "db_psycopg.py");
    const findings = detectPythonPatterns(file);

    const dbFindings = findings.filter(
      (f) => f.pattern === "database_connection",
    );

    expect(dbFindings.length).toBeGreaterThan(0);
    const first = dbFindings[0];
    expect(first.properties.client).toBe("psycopg2");
    expect(first.properties.databaseType).toBe("postgres");
  });

  it("detects requests-based external HTTP calls as external_api_call findings", () => {
    const content = [
      "import requests",
      "",
      "def call_api():",
      "    response = requests.get('https://example.com/items')",
      "    return response.json()",
      "",
    ].join("\n");

    const file = makePythonFile(content, "external_requests.py");
    const findings = detectPythonPatterns(file);

    const apiFindings = findings.filter(
      (f) => f.pattern === "external_api_call",
    );

    expect(apiFindings.length).toBeGreaterThan(0);
    const first = apiFindings[0];
    expect(first.name).toBe("requests_call");
    expect(first.properties.url).toBe("https://example.com/items");
  });

  it("detects jwt usage as auth_middleware findings", () => {
    const content = [
      "import jwt",
      "",
      "def make_token(payload):",
      "    return jwt.encode(payload, 'secret', algorithm='HS256')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "auth_jwt.py");
    const findings = detectPythonPatterns(file);

    const authFindings = findings.filter(
      (f) => f.pattern === "auth_middleware",
    );

    expect(authFindings.length).toBeGreaterThan(0);
    const first = authFindings[0];
    expect(first.name).toBe("jwt_auth");
    expect(first.properties.strategy).toBe("jwt");
  });

  it("detects os.environ usage as env_variable findings", () => {
    const content = [
      "import os",
      "",
      "DB_URL = os.environ['DATABASE_URL']",
      "API_KEY = os.getenv('API_KEY')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "config_env.py");
    const findings = detectPythonPatterns(file);

    const envFindings = findings.filter(
      (f) => f.pattern === "env_variable",
    );

    expect(envFindings.length).toBeGreaterThanOrEqual(2);
    const keys = envFindings.map((f) => f.properties.key);
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("API_KEY");
  });

  it("detects sentry_sdk usage as external_api_call findings with serviceName 'sentry'", () => {
    const content = [
      "import sentry_sdk",
      "",
      "sentry_sdk.init(dsn='https://examplePublicKey@o0.ingest.sentry.io/0')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "sentry_sdk_example.py");
    const findings = detectPythonPatterns(file);

    const sentryFindings = findings.filter(
      (f) => f.pattern === "external_api_call",
    );

    expect(sentryFindings.length).toBeGreaterThan(0);
    const first = sentryFindings[0];
    expect(first.name).toBe("sentry");
    expect(first.properties.serviceName).toBe("sentry");
  });

  it("detects Flask route handlers as express_route findings", () => {
    const content = [
      "from flask import Flask",
      "",
      "app = Flask(__name__)",
      "",
      "@app.route('/items/{item_id}')",
      "def read_item(item_id):",
      "    return {'item_id': item_id}",
      "",
    ].join("\n");

    const file = makePythonFile(content, "flask_app.py");
    const findings = detectPythonPatterns(file);

    const routeFindings = findings.filter((f) => f.pattern === "express_route");
    expect(routeFindings.length).toBeGreaterThan(0);

    const first = routeFindings[0];
    expect(first.properties.framework).toBe("flask");
    expect(first.properties.path).toBe("/items/{item_id}");
    expect(first.name).toContain("GET");
  });

  it("detects Django class-based views from urls.py route bindings", () => {
    const content = [
      "from django.urls import path",
      "from .views import UserListView",
      "",
      "urlpatterns = [",
      "    path('users/', UserListView.as_view(), name='user-list'),",
      "]",
      "",
    ].join("\n");

    const file = makePythonFile(content, "project/urls.py");
    const findings = detectPythonPatterns(file);
    const routeFindings = findings.filter((f) => f.pattern === "express_route");

    expect(routeFindings.length).toBeGreaterThan(0);
    const classBased = routeFindings.find(
      (f) =>
        f.properties.framework === "django" &&
        f.properties.path === "users/" &&
        f.properties.handlerType === "class_based_view",
    );
    expect(classBased).toBeDefined();
  });

  it("detects DRF function-based views using @api_view", () => {
    const content = [
      "from rest_framework.decorators import api_view",
      "",
      "@api_view(['GET', 'POST'])",
      "def users(request):",
      "    return None",
      "",
    ].join("\n");

    const file = makePythonFile(content, "api/views.py");
    const findings = detectPythonPatterns(file);
    const routeFindings = findings.filter((f) => f.pattern === "express_route");

    expect(routeFindings.length).toBeGreaterThan(0);
    const drfFinding = routeFindings.find(
      (f) =>
        f.properties.framework === "drf" &&
        f.properties.handlerType === "function_based_view",
    );
    expect(drfFinding).toBeDefined();
    expect(drfFinding?.properties.httpMethods).toEqual(["GET", "POST"]);
  });

  it("detects DRF router.register(...) viewset routes in urls.py", () => {
    const content = [
      "from rest_framework.routers import DefaultRouter",
      "from .views import UserViewSet",
      "",
      "router = DefaultRouter()",
      "router.register('users', UserViewSet, basename='user')",
      "",
      "urlpatterns = router.urls",
      "",
    ].join("\n");

    const file = makePythonFile(content, "api/urls.py");
    const findings = detectPythonPatterns(file);
    const routeFindings = findings.filter((f) => f.pattern === "express_route");

    expect(routeFindings.length).toBeGreaterThan(0);
    const drfRoute = routeFindings.find(
      (f) =>
        f.name === "DRF_ROUTE users" &&
        f.properties.framework === "drf" &&
        f.properties.handlerType === "viewset_route",
    );
    expect(drfRoute).toBeDefined();
    expect(drfRoute?.properties.handler).toBe("UserViewSet");
  });

  it("detects login_required decorator usage as auth_middleware findings", () => {
    const content = [
      "from somewhere import login_required",
      "",
      "@login_required",
      "def dashboard():",
      "    return 'ok'",
      "",
    ].join("\n");

    const file = makePythonFile(content, "auth_login_required.py");
    const findings = detectPythonPatterns(file);

    const authFindings = findings.filter((f) => f.pattern === "auth_middleware");
    expect(authFindings.length).toBeGreaterThan(0);
    expect(authFindings[0].name).toBe("auth_decorator");
  });

  it("detects dotenv usage as config_file findings (dotenv_config)", () => {
    const content = [
      "import os",
      "from dotenv import load_dotenv",
      "",
      "load_dotenv('.env')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "dotenv_example.py");
    const findings = detectPythonPatterns(file);

    const dotenvFindings = findings.filter(
      (f) => f.pattern === "config_file" && f.name === "dotenv_config",
    );
    expect(dotenvFindings.length).toBeGreaterThan(0);
  });

  it("detects SQLAlchemy connections as database_connection findings", () => {
    const content = [
      "from sqlalchemy import create_engine",
      "",
      "engine = create_engine('postgresql://user:pass@localhost/db')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "db_sqlalchemy.py");
    const findings = detectPythonPatterns(file);

    const dbFindings = findings.filter((f) => f.pattern === "database_connection");
    expect(dbFindings.length).toBeGreaterThan(0);

    const first = dbFindings[0];
    expect(first.properties.client).toBe("sqlalchemy");
    expect(first.properties.databaseType).toBe("sql");
  });

  it("detects Django ORM usage (.objects.) as database_connection findings", () => {
    const content = [
      "from django.db import models",
      "",
      "def list_users():",
      "    return models.User.objects.all()",
      "",
    ].join("\n");

    const file = makePythonFile(content, "db_django_orm.py");
    const findings = detectPythonPatterns(file);

    const dbFindings = findings.filter((f) => f.pattern === "database_connection");
    expect(dbFindings.length).toBeGreaterThan(0);

    const first = dbFindings[0];
    expect(first.properties.client).toBe("django_orm");
    expect(first.properties.databaseType).toBe("sql");
  });

  it("infers serviceName from external API URLs (e.g. requests to api.openai.com)", () => {
    const content = [
      "import requests",
      "",
      "response = requests.get('https://api.openai.com/v1/chat/completions')",
      "",
    ].join("\n");

    const file = makePythonFile(content, "external_requests_openai.py");
    const findings = detectPythonPatterns(file);

    const apiFindings = findings.filter((f) => f.pattern === "external_api_call");
    expect(apiFindings.length).toBeGreaterThan(0);

    const first = apiFindings[0];
    expect(first.name).toBe("requests_call");
    expect(first.properties.url).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(first.properties.serviceName).toBe("openai");
  });

  it.each([
    { moduleName: "boto3", expectedServiceName: "aws" },
    { moduleName: "stripe", expectedServiceName: "stripe" },
    { moduleName: "sendgrid", expectedServiceName: "sendgrid" },
    { moduleName: "twilio.rest", expectedServiceName: "twilio" },
    { moduleName: "openai", expectedServiceName: "openai" },
  ])(
    "detects common Python SDK imports as external_api_call findings (%s)",
    ({ moduleName, expectedServiceName }) => {
      const content = [
        `import ${moduleName}`,
        "",
        "def run():",
        "    return True",
        "",
      ].join("\n");

      const file = makePythonFile(content, `${expectedServiceName}_sdk.py`);
      const findings = detectPythonPatterns(file);
      const apiFindings = findings.filter((f) => f.pattern === "external_api_call");

      expect(apiFindings.length).toBeGreaterThan(0);

      const serviceFinding = apiFindings.find(
        (f) =>
          f.name === expectedServiceName &&
          f.properties.serviceName === expectedServiceName,
      );
      expect(serviceFinding).toBeDefined();
    },
  );
});

