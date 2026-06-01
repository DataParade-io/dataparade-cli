import express from "express";

type RequestLike = { [key: string]: unknown };
type ResponseLike = { json: (body: unknown) => void };

const app = express();

app.get("/health", async (_req: RequestLike, res: ResponseLike) => {
  await fetch("https://api.stripe.com/v1/charges");
  res.json({ ok: true });
});

export default app;
