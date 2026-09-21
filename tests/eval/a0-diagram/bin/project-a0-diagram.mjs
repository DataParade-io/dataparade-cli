#!/usr/bin/env node
/**
 * DATAP-699: project dogfood OCSF Discoveries + pinned A0 brief → dataflow.json + D2/SVG.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join(__dirname, "../../../../dist/tests/eval/a0-diagram");

async function loadModules() {
  const required = [
    "a0-diagram-projector.js",
    "load-ocsf-discoveries.js",
    "write-a0-diagram-artifacts.js",
  ];
  for (const file of required) {
    if (!fs.existsSync(path.join(distRoot, file))) {
      throw new Error(
        "Build required: pnpm exec tsc -p tsconfig.json before running project-a0-diagram",
      );
    }
  }
  const projector = await import(path.join(distRoot, "a0-diagram-projector.js"));
  const loader = await import(path.join(distRoot, "load-ocsf-discoveries.js"));
  const writer = await import(path.join(distRoot, "write-a0-diagram-artifacts.js"));
  const manifest = await import(path.join(distRoot, "../interview-a0/manifest.js"));
  const parseBrief = await import(path.join(distRoot, "../interview-a0/parse-brief.js"));
  const parseSkill = await import(path.join(distRoot, "../interview-a0/parse-skill.js"));
  return { projector, loader, writer, manifest, parseBrief, parseSkill };
}

function parseArgs(argv) {
  const options = {
    mode: "interview",
    briefPath: undefined,
    discoveriesDir: undefined,
    outputDir: ".",
    basename: "a0-dogfood",
    projectName: "dogfood-a0",
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      options.mode = argv[++i];
      continue;
    }
    if (arg === "--brief") {
      options.briefPath = argv[++i];
      continue;
    }
    if (arg === "--discoveries") {
      options.discoveriesDir = argv[++i];
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = argv[++i];
      continue;
    }
    if (arg === "--basename") {
      options.basename = argv[++i];
      continue;
    }
    if (arg === "--project-name") {
      options.projectName = argv[++i];
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    throw new Error(`Unexpected arguments: ${positional.join(" ")}`);
  }
  if (!options.discoveriesDir) {
    throw new Error("--discoveries <ocsf-discoveries-dir> is required");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node project-a0-diagram.mjs --discoveries <dir> [options]

Options:
  --mode interview|filled     Projector mode (default interview)
  --brief <path>              Dogfood brief markdown (default: pinned eval fixture)
  --discoveries <dir>         OCSF Discovery JSON directory
  --output-dir <dir>          Write artifacts here (default: cwd)
  --basename <name>           Output file basename (default a0-dogfood)
  --project-name <name>       diagram.json metadata.projectName`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { projector, loader, writer, manifest, parseBrief, parseSkill } = await loadModules();

  const fixtureRoot = path.join(__dirname, "../../interview-a0/fixtures");
  const briefManifest = manifest.loadBriefManifest(
    path.join(fixtureRoot, "brief.manifest.yaml"),
  );
  const briefMarkdown = options.briefPath
    ? fs.readFileSync(path.resolve(options.briefPath), "utf8")
    : fs.readFileSync(path.join(fixtureRoot, briefManifest.brief_fixture), "utf8");
  const skillMarkdown = fs.readFileSync(
    path.join(fixtureRoot, briefManifest.skill_fixture),
    "utf8",
  );
  parseSkill.assertBriefShaMatchesPin(skillMarkdown, briefManifest.commit);
  const briefSnapshot = parseBrief.parseBriefMarkdown(briefMarkdown, briefManifest.commit);
  briefSnapshot.taxonomy = parseSkill.parseTaxonomyFromSkill(skillMarkdown);
  const discoveries = loader.loadOcsfDiscoveriesFromDir(path.resolve(options.discoveriesDir));

  const discoveriesDocument = projector.buildA0DiscoveriesDocument({
    briefMarkdown,
    discoveries,
  });
  const diagramWrapper = projector.buildA0DiagramWrapper({
    briefMarkdown,
    brief: briefSnapshot,
    discoveries,
    discoveriesDocument,
    mode: options.mode,
    projectName: options.projectName,
  });

  const paths = writer.writeA0DiagramArtifacts({
    discoveriesDocument,
    diagramWrapper,
    outputDir: options.outputDir,
    basename: options.basename,
  });

  process.stdout.write(`${JSON.stringify({ mode: options.mode, ...paths }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
