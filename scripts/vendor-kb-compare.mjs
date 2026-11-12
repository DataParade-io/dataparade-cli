// Bundles the compiled @dataparade/kb-compare (packages/kb-compare in this monorepo) into the CLI's
// build output, the same way vendor-scanner.mjs bundles the scanner, so the published package has
// no workspace dependency (DATAP-852). Runs after `tsc`:
//   1. copies packages/kb-compare/dist/src into dist/vendor/kb-compare/dist/src
//   2. rewrites "@dataparade/kb-compare" specifiers in dist/**/*.js and *.d.ts to relative paths
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { cliRoot } from "./scanner-root.mjs";

const SPECIFIER = "@dataparade/kb-compare";
const packageRoot = join(cliRoot, "..", "packages", "kb-compare");
const distDir = join(cliRoot, "dist");
const vendorDir = join(distDir, "vendor", "kb-compare");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p === join(distDir, "vendor")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|d\.ts)$/.test(name)) out.push(p);
  }
  return out;
}

const packageDist = join(packageRoot, "dist", "src");
if (!existsSync(join(packageDist, "index.js"))) {
  throw new Error("kb-compare is not built; run `pnpm --filter @dataparade/kb-compare build` first.");
}
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
// Its runtime dependencies resolve from the CLI's node_modules, so the CLI must declare them.
const cliPkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
const missing = Object.entries(pkg.dependencies ?? {}).filter(([name, range]) => cliPkg.dependencies?.[name] !== range);
if (missing.length > 0) {
  throw new Error(`kb-compare runtime dependencies missing/different in cli/package.json "dependencies": ${missing.map(([n, r]) => `${n}@${r}`).join(", ")}`);
}

rmSync(vendorDir, { recursive: true, force: true });
mkdirSync(join(vendorDir, "dist"), { recursive: true });
cpSync(packageDist, join(vendorDir, "dist", "src"), { recursive: true });
writeFileSync(
  join(vendorDir, "package.json"),
  `${JSON.stringify({ name: pkg.name, version: pkg.version, description: "Vendored build of @dataparade/kb-compare bundled into @dataparade/cli", main: "dist/src/index.js" }, null, 2)}\n`,
);

const entry = join(vendorDir, "dist", "src", "index.js");
let rewritten = 0;
for (const file of walk(distDir)) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(SPECIFIER)) continue;
  let rel = relative(dirname(file), entry).split(sep).join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  writeFileSync(file, text.replace(/(["'])@dataparade\/kb-compare\1/g, (_m, q) => `${q}${rel}${q}`));
  rewritten += 1;
}
console.log(`[vendor-kb-compare] vendored kb-compare ${pkg.version}; rewrote imports in ${rewritten} files`);
