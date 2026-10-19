// Bundles the compiled @dataparade/scanner into the CLI's own build output so the published
// package needs no Git dependency. Runs after `tsc` (see the `build` script):
//   1. copies the scanner's dist/src, patterns/ and licence into dist/vendor/scanner/
//      (layout kept identical to the scanner package, which locates patterns/ relative to its dist/)
//   2. rewrites "@dataparade/scanner" specifiers in dist/**/*.js and *.d.ts to relative paths
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { cliRoot, resolveScannerRoot } from "./scanner-root.mjs";

const SPECIFIER = "@dataparade/scanner";
const distDir = join(cliRoot, "dist");
const vendorDir = join(distDir, "vendor", "scanner");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p === join(distDir, "vendor")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|d\.ts)$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const scannerRoot = resolveScannerRoot();
  const scannerDist = join(scannerRoot, "dist", "src");
  if (!existsSync(join(scannerDist, "index.js"))) {
    throw new Error("Scanner is not built; run `node scripts/ensure-scanner-built.mjs` first.");
  }
  if (!existsSync(join(distDir, "src"))) {
    throw new Error("CLI is not compiled; run tsc first.");
  }

  const scannerPkg = JSON.parse(readFileSync(join(scannerRoot, "package.json"), "utf8"));
  // The scanner's runtime dependencies must be installed by the CLI itself, since the scanner is
  // no longer a package of its own. Fail the build if a scanner bump adds or changes one.
  const cliPkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
  const mismatched = Object.entries(scannerPkg.dependencies ?? {}).filter(
    ([name, range]) => cliPkg.dependencies?.[name] !== range,
  );
  if (mismatched.length > 0) {
    throw new Error(
      "Scanner runtime dependencies missing/different in cli/package.json \"dependencies\": " +
        mismatched.map(([n, r]) => `${n}@${r}`).join(", "),
    );
  }

  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(join(vendorDir, "dist"), { recursive: true });
  cpSync(scannerDist, join(vendorDir, "dist", "src"), { recursive: true });
  cpSync(join(scannerRoot, "patterns"), join(vendorDir, "patterns"), { recursive: true });
  for (const file of ["LICENSE", "NOTICE"]) {
    if (existsSync(join(scannerRoot, file))) {
      cpSync(join(scannerRoot, file), join(vendorDir, file));
    }
  }
  // Minimal manifest: marks the package root for the scanner's own path lookups. No dependencies —
  // typescript, yaml and zod are dependencies of @dataparade/cli and resolve from its node_modules.
  writeFileSync(
    join(vendorDir, "package.json"),
    JSON.stringify(
      {
        name: scannerPkg.name,
        version: scannerPkg.version,
        license: scannerPkg.license,
        description: "Vendored build of @dataparade/scanner bundled into @dataparade/cli",
        main: "dist/src/index.js",
      },
      null,
      2,
    ) + "\n",
  );

  const entry = join(vendorDir, "dist", "src", "index.js");
  let rewritten = 0;
  for (const file of walk(distDir)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(SPECIFIER)) continue;
    let rel = relative(dirname(file), entry).split(sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    const next = text.replace(/(["'])@dataparade\/scanner\1/g, (_m, q) => `${q}${rel}${q}`);
    writeFileSync(file, next);
    rewritten += 1;
  }
  console.log(`[vendor-scanner] vendored scanner ${scannerPkg.version}; rewrote imports in ${rewritten} files`);
}

main();
