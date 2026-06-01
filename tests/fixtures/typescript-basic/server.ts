// Minimal typings to avoid bringing in express/passport types as dev dependencies.
type RequestLike = { [key: string]: unknown };
type ResponseLike = { send: (body: unknown) => void };

declare const app: {
  get: (
    path: string,
    ...handlers: Array<
      (req: RequestLike, res: ResponseLike, next?: () => void) => void
    >
  ) => void;
};

declare const passport: {
  authenticate: (
    strategy: string,
    options?: { session?: boolean },
  ) => (req: RequestLike, res: ResponseLike, next: (() => void) | undefined) => void;
};

app.get(
  "/users",
  passport.authenticate("jwt", { session: false }),
  (req, res) => {
    res.send("ok");
  },
);

