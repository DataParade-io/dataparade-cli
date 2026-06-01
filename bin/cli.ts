#!/usr/bin/env node

import "./load-env";
import { run } from "../src/cli";
import { flushCliSentry } from "../src/observability/scan-sentry";

void run().finally(() => flushCliSentry());
