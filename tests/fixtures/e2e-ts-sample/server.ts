// Minimal typings to avoid bringing in express/passport types as dev dependencies.
type E2eRequestLike = { [key: string]: unknown };
type E2eResponseLike = { send: (body: unknown) => void };

declare const e2eApp: {
  get: (
    path: string,
    ...handlers: Array<
      (req: E2eRequestLike, res: E2eResponseLike, next?: () => void) => void
    >
  ) => void;
};

declare const e2ePassport: {
  authenticate: (
    strategy: string,
    options?: { session?: boolean },
  ) => (
    req: E2eRequestLike,
    res: E2eResponseLike,
    next: (() => void) | undefined,
  ) => void;
};

e2eApp.get(
  "/users",
  e2ePassport.authenticate("jwt", { session: false }),
  (req, res) => {
    res.send("ok");
  },
);

