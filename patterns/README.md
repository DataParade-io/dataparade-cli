# TypeScript / JavaScript Patterns

This document describes the TypeScript/JavaScript patterns implemented by the
CLI TS/JS analyzer for **DP-P0-CLI-104**. These patterns are heuristic and not
exhaustive; they are designed to provide useful structural signals for the
classifier and data-flow detector.

Patterns are configured in two layers:

- A **YAML configuration file** at `cli/patterns/typescript.patterns.yaml`
  which defines pattern IDs, known libraries/SDKs, regexes, and confidences.
- A **TypeScript execution engine** (`cli/src/analyzers/typescript/typescript-detection.ts`
  and `cli/src/analyzers/typescript/typescript-detection-config.ts`) that loads the YAML,
  validates it, compiles regexes, and applies them to `FileInfo` plus the TS/JS
  code model.

Each detected match produces a `RawFinding` object using the shared `PatternId`
union from `cli/src/core/types/detection.ts`. The YAML file controls **what**
we look for (libraries, regexes, keys); the TypeScript engine controls **how**
those patterns are applied.

---

## `express_route`

**Purpose:** Detect HTTP route handlers in common web frameworks.

**Frameworks covered (heuristic):**

- Express (imports from `"express"`)
- NestJS (imports from `"@nestjs/common"` / `"@nestjs/core"`)
- Next.js / React route handlers (file-path based heuristic such as
  `pages/api/*`, `app/*`, `*route.ts`, `*route.js`)

**Examples:**

```ts
// Express
import express from "express";

const app = express();
app.get("/users", (req, res) => {
  res.send("ok");
});
```

```ts
// NestJS
import { Controller, Get } from "@nestjs/common";

@Controller("users")
export class UsersController {
  @Get("/")
  findAll() {}
}
```

```ts
// Next.js API route (pages/api/users.ts)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ ok: true });
}
```

**Properties set on `RawFinding.properties`:**

- `framework: "express" | "nest" | "next_or_react_route"`
- `httpMethods: string[]` – e.g. `["GET"]` when a method can be inferred
- `path?: string` – route path when it can be parsed (e.g. `"/users"`)

---

## `database_connection`

**Purpose:** Detect creation or usage of database and cache clients.

**Libraries covered (heuristic):**

- `pg` (`new Pool(...)`, `new Client(...)`)
- `mysql2` (`createConnection(...)`)
- Prisma (`new PrismaClient(...)`)
- Mongoose (`mongoose.connect(...)`)
- Redis (`createClient(...)`)
- Supabase (`createClient(...)` from `@supabase/supabase-js`)

**Examples:**

```ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
```

```ts
import mongoose from "mongoose";

mongoose.connect(process.env.MONGO_URL!);
```

**Properties set on `RawFinding.properties`:**

- `client: string` – e.g. `"pg"`, `"mysql2"`, `"prisma"`, `"mongoose"`, `"redis"`, `"supabase"`
- `databaseType: string` – e.g. `"postgres"`, `"mysql"`, `"mongo"`, `"redis"`, `"unknown"`
- For heuristic SQL keyword matches, an additional hint:
  - `hint: "raw_sql_keyword"`

---

## `external_api_call`

**Purpose:** Detect calls to external HTTP APIs or third-party SDKs.

**HTTP clients covered (heuristic):**

- Global `fetch(...)`
- `axios.get/post/put/delete/patch(...)`
- `got(...)`

**Known SDK/service hints:**

- Stripe (`"stripe"`)
- SendGrid (`"sendgrid"`)
- Twilio (`"twilio"`)
- OpenAI (`"openai"`)
- AWS SDK (`"@aws-sdk/..."`)
- Firebase (`"firebase"`)

**Examples:**

```ts
// Generic HTTP call
const res = await fetch("https://api.example.com/users");
```

```ts
// Axios with method
import axios from "axios";

await axios.post("https://api.example.com/users", { name: "Alice" });
```

```ts
// Stripe SDK import
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_KEY!, { apiVersion: "2022-11-15" });
```

**Properties set on `RawFinding.properties`:**

- For direct HTTP calls:
  - `client: string` – e.g. `"fetch"`, `"axios.get"`, `"axios.post"`, `"got"`
  - `url: string` – full URL if present in the call
  - `httpMethod?: string` – uppercase method when derivable
- For SDK / service hints:
  - `client: string` – service/client identifier, e.g. `"stripe"`
  - `serviceName: string` – same as `client` for now

---

## `auth_middleware`

**Purpose:** Detect authentication/authorization-related middleware and guards.

**Libraries and patterns covered (heuristic):**

- Passport (`passport.authenticate(...)`, imports from `"passport"` or modules containing `"passport"`)
- JSON Web Tokens (`jsonwebtoken`, `jwt.sign(...)`, `jwt.verify(...)`)
- NestJS auth guards (`@nestjs/passport`, `UseGuards(...)`)

**Examples:**

```ts
import passport from "passport";

app.get(
  "/profile",
  passport.authenticate("jwt", { session: false }),
  (req, res) => res.send("ok"),
);
```

```ts
import jwt from "jsonwebtoken";

const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET!);
```

```ts
import { UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@UseGuards(AuthGuard("jwt"))
@Get("me")
getProfile() {}
```

**Properties set on `RawFinding.properties`:**

- For Passport:
  - `library: "passport"`
  - `strategy?: string` – strategy name when parsed from `passport.authenticate("strategy", ...)`
- For JWT:
  - `library: "jsonwebtoken"`
- For NestJS guards:
  - `library: "nestjs_auth"`

---

## `env_variable`

**Purpose:** Detect environment variable usage in TS/JS code.

**Pattern:** `process.env.<KEY>`

**Examples:**

```ts
const dbUrl = process.env.DATABASE_URL;
const apiKey = process.env.API_KEY;
```

**Properties set on `RawFinding.properties`:**

- `key: string` – the environment variable key, e.g. `"DATABASE_URL"`, `"API_KEY"`

---

## `config_file`

**Purpose:** Detect access to configuration objects in TS/JS code that likely
point to configuration or secret values (for later mapping to assets or
environment configuration).

**Pattern:** `config.<field>` where `<field>` is one of:

- `database`
- `db`
- `apiKey`
- `api_key`
- `auth`
- `redis`

**Examples:**

```ts
import config from "./config";

const dbConfig = config.database;
const redisConfig = config.redis;
```

**Properties set on `RawFinding.properties`:**

- `key: string` – the accessed config key, e.g. `"database"`, `"apiKey"`

---

## Actor detection (`web_actor`, `service_actor`)

**Purpose:** Detect human and system actors so the classifier can emit
`DetectedComponent` entries with `type: "actor"` alongside assets and third
parties.

Actor detection is configured in a shared YAML file:

-- `cli/patterns/actor.patterns.yaml` – defines regexes and rules for emitting
  `web_actor` and `service_actor` findings, and attaches basic properties such
  as `actorType`, `roleNames`, and `sourceContext`.

The classifier maps these pattern IDs to actors via `classifier/components.classifier.yaml`:

- `web_actor` → `type: actor`, `subType: customer`
- `service_actor` → `type: actor`, `subType: employee`

### Signals used by the TS/JS analyzer

The TypeScript/JavaScript analyzer loads `actor.patterns.yaml` through
`cli/src/config/actor-detection-config.ts` and applies rules in
`cli/src/analyzers/typescript/actor-detection.ts`. Current heuristics include:

- **Frontend session hook**
  - File path matches `hooks/useSession.ts` / `hooks/useSession.tsx`.
  - Emits a `web_actor` finding named `"Customer"` with:
    - `properties.actorType = "customer"`
    - `properties.sourceContext = "frontend_session"`.

- **Backend controllers using `req.user`**
  - Content contains `req.user` (e.g. NestJS/Express controllers).
  - Emits a `web_actor` finding named `"Customer"` with:
    - `properties.actorType = "customer"`
    - `properties.sourceContext = "backend_controller"`.

- **Backend admin role checks**
  - Content contains simple admin role checks (e.g. `isAdmin`, `role: "admin"`).
  - Emits a `service_actor` finding named `"Admin user"` with:
    - `properties.actorType = "employee"`
    - `properties.roleNames = ["admin"]`
    - `properties.sourceContext = "backend_role_check"`.

Other language analyzers can reuse the same `web_actor` / `service_actor`
pattern IDs by loading `actor.patterns.yaml` and emitting compatible
`RawFinding`s; the classifier does not need to change for each language.

---

These patterns are intentionally conservative and heuristic. They are meant to
provide a good baseline for:

- Component classification (assets, third parties, etc.).
- Structural data-flow detection (who talks to which DB / third-party).

Additional patterns and refinements can be added in future tasks and should be
documented by extending this file.
