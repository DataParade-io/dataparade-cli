# Python Patterns (CLI Scanner)

This document describes the Python-specific patterns implemented by the CLI codebase scanner for **DP-P0-CLI-703 – Python pattern detector**.

The Python analyzer emits `RawFinding[]` using the **shared pattern IDs** from `core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`

These pattern IDs align with the TypeScript/JavaScript analyzer so that the classifier and data-flow detector can treat Python and TS/JS findings consistently.

## Route / Handler Detection (`express_route`)

The Python analyzer reuses the `express_route` pattern ID for web routes and handlers in common Python web frameworks.

### FastAPI

- **Detected when:**
  - The module imports `FastAPI` or any symbol from `fastapi`.
  - A function has a decorator starting with `app.get`, `app.post`, `app.put`, `app.delete`, or `app.patch`.
- **Emitted finding:**
  - `pattern`: `express_route`
  - `name`: `"<METHOD> <function_name>"` (e.g. `GET read_item`)
  - `properties`:
    - `framework`: `"fastapi"`
    - `httpMethods`: `[ "<METHOD>" ]`

**Example:**

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}")
async def read_item(item_id: int):
    ...
```

### Flask

- **Detected when:**
  - The module imports from `flask` or imports `Flask`.
  - A function has a decorator starting with `app.route`, `bp.route`, or `blueprint.route`.
- **Emitted finding:**
  - `pattern`: `express_route`
  - `name`: `"FLASK_ROUTE <function_name>"`
  - `properties`:
    - `framework`: `"flask"`

**Example:**

```python
from flask import Flask

app = Flask(__name__)

@app.route("/users", methods=["GET"])
def list_users():
    ...
```

### Django / Django REST Framework

- **Detected when:**
  - The file path ends with `urls.py` or imports start with `django.`.
  - A line contains `path("...")`, `re_path("...")`, or `url("...")`.
- **Emitted finding:**
  - `pattern`: `express_route`
  - `name`: `"DJANGO_ROUTE <path>"`
  - `properties`:
    - `framework`: `"django"`
    - `path`: `"<route_path>"`

**Example (`urls.py`):**

```python
from django.urls import path
from . import views

urlpatterns = [
    path("users/", views.user_list, name="user-list"),
]
```

### Starlette

- **Detected when:**
  - The module imports Starlette (module name contains `"starlette"`).
  - A function has a decorator starting with `app.route`.
- **Emitted finding:**
  - `pattern`: `express_route`
  - `name`: `"STARLETTE_ROUTE <function_name>"`
  - `properties`:
    - `framework`: `"starlette"`

### Bottle

- **Detected when:**
  - The module imports from `bottle` or imports `Bottle`.
  - A function has decorators `@route`, `@get`, `@post`, `@put`, or `@delete`.
- **Emitted finding:**
  - `pattern`: `express_route`
  - `name`: `"BOTTLE_ROUTE <function_name>"`
  - `properties`:
    - `framework`: `"bottle"`

## Database / ORM Detection (`database_connection`)

The Python analyzer emits `database_connection` for database clients and ORM usage.

### psycopg2

- **Detected when:**
  - The module imports from `psycopg2` / `psycopg`.
  - A module-level call contains `connect` (e.g. `psycopg2.connect(...)`).
- **Properties:**
  - `client`: `"psycopg2"`
  - `databaseType`: `"postgres"`

### SQLAlchemy

- **Detected when:**
  - The module imports from `sqlalchemy` or imports `create_engine`.
  - A module-level call contains `create_engine`.
- **Properties:**
  - `client`: `"sqlalchemy"`
  - `databaseType`: `"sql"`

### Django ORM

- **Detected when:**
  - The module imports from `django.db` or the content includes `.objects.`.
- **Properties:**
  - `client`: `"django_orm"`
  - `databaseType`: `"sql"`

## External HTTP / API Calls (`external_api_call`)

The Python analyzer emits `external_api_call` for HTTP clients and SDKs.

### HTTP client libraries

- **requests**
  - Detected when the module imports `requests` and a module-level call starts with `requests.`.
  - `name`: `"requests_call"`
  - `properties.url`: first `http(s)` URL literal found in the file, if any.

- **httpx**
  - Detected when the module imports `httpx` and a module-level call starts with `httpx.`.
  - `name`: `"httpx_call"`

- **aiohttp**
  - Detected when the module imports `aiohttp` or `ClientSession` and a module-level call references `ClientSession` or `.get`.
  - `name`: `"aiohttp_call"`

### SDKs

The analyzer also emits `external_api_call` findings when the module imports:

- `boto3` → `name`: `"boto3_client"`, `serviceName`: `"aws"`
- `stripe` → `name`: `"stripe_sdk"`, `serviceName`: `"stripe"`
- `sendgrid` → `name`: `"sendgrid_sdk"`, `serviceName`: `"sendgrid"`
- `twilio` → `name`: `"twilio_sdk"`, `serviceName`: `"twilio"`
- `openai` → `name`: `"openai_sdk"`, `serviceName`: `"openai"`

## Auth Patterns (`auth_middleware`)

The Python analyzer emits `auth_middleware` findings for common auth patterns.

- **JWT-based auth**
  - Detected when:
    - The module imports a module containing `"jwt"`, imports `jwt`, or
    - The content includes `jwt.encode(` or `jwt.decode(`.
  - `name`: `"jwt_auth"`
  - `properties.strategy`: `"jwt"`

- **Auth decorators / permissions**
  - Detected when module-level calls reference `login_required` or `IsAuthenticated`.
  - `name`: `"auth_decorator"`

- **Generic auth libraries**
  - Detected when imports contain `"auth"` or `"authentication"`.
  - `name`: `"auth_library"`

## Config and Environment (`config_file`, `env_variable`)

### Environment variables (`env_variable`)

- **Detected when:**
  - The module imports `os`, and lines reference:
    - `os.environ["KEY"]` or `os.environ['KEY']`
    - `os.getenv("KEY")` or `os.getenv('KEY')`
- **Emitted finding:**
  - `pattern`: `env_variable`
  - `name`: `"os.environ[KEY]"`
  - `properties.key`: `"KEY"`

### Config files (`config_file`)

- **Django settings**
  - Detected when the file path ends with `settings.py`.
  - `name`: `"django_settings"`

- **dotenv configuration**
  - Detected when the module imports `os` and the content includes `load_dotenv(`.
  - `name`: `"dotenv_config"`
