import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { gapsFromOcsfDir } from "../../gaps-from-ocsf";
import { resolveOcsfKbDir } from "./ocsf-kb-config";

const experimentDir = path.dirname(fileURLToPath(import.meta.url));
const ocsfDir = resolveOcsfKbDir();
const report = gapsFromOcsfDir(ocsfDir);
const outPath = path.join(experimentDir, "gap-report.json");
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath} (${report.gaps.length} gaps, snapshot.sha=${report.snapshot.sha})`);
