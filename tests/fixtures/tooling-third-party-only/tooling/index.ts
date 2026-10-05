import * as Sentry from "@sentry/node";
export const init = () => Sentry.init({ dsn: "x" });
