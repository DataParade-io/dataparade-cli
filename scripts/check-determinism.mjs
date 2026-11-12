#!/usr/bin/env node
// Determinism check for the scan output (DATAP-846).
//
// Scans one fixture three times with the built CLI: twice in the same folder, and once in a
// folder with another name, under LC_ALL=C and another time zone. The Facts (facts.json without
// its `scan` block, and every data-items/*.json file) must be identical, and every component and
// flow must carry an identity whose key hashes to its id. Comparing knowledge-base versions
// (DATAP-841) depends on this.
//
// It also checks that no key contains the scan root, and that no group key ends in a line
// number (a declaration-named group's key drops the line).
//
// Usage: node scripts/check-determinism.mjs [fixtureDir ...]   (run `pnpm build` first)
// With no fixture, it checks java-basic, monorepo-app-plus-terraform and e2e-ts-sample (DATAP-858).
//
// A scan without a configured project name names the root Application component after the
// scanned folder. That display name may differ; its key and id must not (DATAP-858), so the
// comparison ignores only the name of the component keyed by the <project> token.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliBin = join(cliRoot, "dist", "bin", "cli.js");
const args = process.argv.slice(2);
const fixtureArgs = args.filter((a) => !a.startsWith("--"));
const fixtures = (fixtureArgs.length > 0 ? fixtureArgs : ["java-basic", "monorepo-app-plus-terraform", "e2e-ts-sample"].map((f) => join(cliRoot, "tests", "fixtures", f))).map((f) => resolve(f));

if (!existsSync(cliBin)) {
  console.error(`[determinism] ${cliBin} is missing. Run \`pnpm build\` in cli/ first.`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "dp-determinism-"));
const baseEnv = {
  ...process.env,
  DATAPARADE_SKIP_AUTO_UPLOAD: "1",
  DATAPARADE_TELEMETRY: "0",
  SCAN_AI_INFERENCE: "false",
};

function scan(fixture, label, folderName, env) {
  const repo = join(work, label, folderName);
  cpSync(fixture, repo, { recursive: true });
  const out = join(work, label, "out");
  execFileSync(process.execPath, [cliBin, "scan", repo, "--no-ai-inference", "-o", join(out, "dataflow.json")], {
    env: { ...baseEnv, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const facts = JSON.parse(readFileSync(join(out, "facts.json"), "utf8"));
  const { scan: _scan, ...rest } = facts;
  rest.components = rest.components.map((c) => (c.identity?.parts?.name === "<project>" ? { ...c, name: "<project name>" } : c));
  const itemsDir = join(out, "data-items");
  const items = existsSync(itemsDir)
    ? Object.fromEntries(readdirSync(itemsDir).sort().map((f) => [f, readFileSync(join(itemsDir, f), "utf8")]))
    : {};
  return { label, repo, facts, comparable: JSON.stringify(rest), items: JSON.stringify(items) };
}

function checkIdentities(run) {
  const problems = [];
  const check = (list, prefix) => {
    for (const fact of list) {
      if (!fact.identity) {
        problems.push(`${fact.id}: no identity`);
        continue;
      }
      const { key, duplicateIndex } = fact.identity;
      const base = duplicateIndex ? key.slice(0, -`#${duplicateIndex}`.length) : key;
      if (duplicateIndex && !key.endsWith(`#${duplicateIndex}`)) problems.push(`${fact.id}: key does not end in #${duplicateIndex}`);
      const expected = `${prefix}${createHash("sha256").update(base, "utf8").digest("hex").slice(0, 12)}`;
      if (!fact.id.startsWith(expected)) problems.push(`${fact.id}: identity key hashes to ${expected}`);
    }
  };
  check(run.facts.components, "cmp_");
  check(run.facts.dataFlows, "flow_");
  for (const item of run.facts.dataItems) {
    if (!item.identity) problems.push(`${item.id}: no identity`);
    for (const group of item.groups) {
      if (!group.identity) problems.push(`${group.id}: no identity`);
      else if (/:\d+(#|$)/.test(group.identity.key.replace(/#\d+$/, ""))) problems.push(`${group.id}: group key has a line number`);
    }
  }
  const all = [...run.facts.components, ...run.facts.dataFlows, ...run.facts.dataItems, ...run.facts.dataItems.flatMap((i) => i.groups)];
  for (const fact of all) {
    if (fact.identity && JSON.stringify(fact.identity).includes(run.repo)) problems.push(`${fact.id}: identity contains the scan root`);
  }
  return problems;
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return `…${a.slice(Math.max(0, i - 80), i + 80)}…\n  vs\n…${b.slice(Math.max(0, i - 80), i + 80)}…`;
}

let failed = false;
try {
  for (const [index, fixture] of fixtures.entries()) checkFixture(fixture, `f${index}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);

function checkFixture(fixture, tag) {
  const runs = [
    scan(fixture, `${tag}-first`, "repo", {}),
    scan(fixture, `${tag}-again`, "repo", {}),
    scan(fixture, `${tag}-elsewhere`, "another-folder-name", { LC_ALL: "C", LANG: "C", TZ: "Pacific/Auckland" }),
  ];
  const [reference] = runs;
  let fixtureFailed = false;
  if (reference.facts.components.length === 0 || reference.facts.dataFlows.length === 0) {
    console.error(`[determinism] the fixture gave ${reference.facts.components.length} components and ${reference.facts.dataFlows.length} flows; pick a fixture with both.`);
    fixtureFailed = true;
  }
  for (const run of runs.slice(1)) {
    if (run.comparable !== reference.comparable) {
      console.error(`[determinism] facts.json differs between "${reference.label}" and "${run.label}":\n${firstDifference(reference.comparable, run.comparable)}`);
      fixtureFailed = true;
    }
    if (run.items !== reference.items) {
      console.error(`[determinism] data-items/ differs between "${reference.label}" and "${run.label}".`);
      fixtureFailed = true;
    }
  }
  const problems = checkIdentities(reference);
  if (problems.length > 0) {
    console.error(`[determinism] identity problems:\n  ${problems.slice(0, 20).join("\n  ")}`);
    fixtureFailed = true;
  }
  if (fixtureFailed) {
    failed = true;
  } else {
    const f = reference.facts;
    const groups = f.dataItems.reduce((n, i) => n + i.groups.length, 0);
    console.log(
      `[determinism] OK: 3 scans of ${fixture} gave identical Facts (${f.components.length} components, ${f.dataFlows.length} flows, ${f.dataItems.length} data items, ${groups} groups), and every identity key hashes to its id.`,
    );
  }
}
