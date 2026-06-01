import express from "express";

const app: any = express();

// Express route (used by `express_route` detection).
app.get("/users", (req: any, res: any) => {
  res.send("ok");
});

// Env var usage (used by `env_variable` detection).
const apiKey = process.env.API_KEY;
const awsRegion = process.env.AWS_REGION;

// Sentry ingestion (used by `external_api_call` detection with serviceName inference).
async function callSentry(): Promise<void> {
  await fetch("https://o0.ingest.sentry.io/api/123/envelope/", {
    method: "POST",
    body: "{}",
  });
}

void apiKey;
void awsRegion;
void callSentry;

