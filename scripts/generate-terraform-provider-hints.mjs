#!/usr/bin/env node
/**
 * Builds Terraform resource catalogs + per-service prefix hints from CDKTF packages.
 *
 *   node scripts/generate-terraform-provider-hints.mjs              # AWS + Azure + Kubernetes
 *   node scripts/generate-terraform-provider-hints.mjs --aws-only
 *   node scripts/generate-terraform-provider-hints.mjs --azure-only
 *   node scripts/generate-terraform-provider-hints.mjs --kubernetes-only
 *
 * Optional: CDKTF_PROVIDER_TGZ / CDKTF_PROVIDER_AZURERM_TGZ / CDKTF_PROVIDER_KUBERNETES_TGZ
 *
 * Outputs under cli/patterns/: aws-*.json, azure-*.json, kubernetes-*.json
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const patternsDir = path.join(cliRoot, "patterns");
const patternsYaml = path.join(patternsDir, "terraform.patterns.yaml");

const args = new Set(process.argv.slice(2));
const onlyOneProvider =
  args.has("--aws-only") || args.has("--azure-only") || args.has("--kubernetes-only");
const runAws = args.has("--aws-only") || !onlyOneProvider;
const runAzure = args.has("--azure-only") || !onlyOneProvider;
const runKubernetes = args.has("--kubernetes-only") || !onlyOneProvider;

function serviceTokenAfterPrefix(resourceType, prefix) {
  const p = `${prefix}_`;
  if (!resourceType.startsWith(p)) return null;
  const rest = resourceType.slice(p.length);
  const i = rest.indexOf("_");
  return i === -1 ? rest : rest.slice(0, i);
}

function cdktfFolderToType(folder, { dataPrefix, resourcePrefix, skipDataPrefixes }) {
  for (const sp of skipDataPrefixes ?? []) {
    if (folder.startsWith(sp)) return null;
  }
  if (folder.startsWith(dataPrefix)) {
    return `${resourcePrefix}_${folder.slice(dataPrefix.length).replace(/-/g, "_")}`;
  }
  return `${resourcePrefix}_${folder.replace(/-/g, "_")}`;
}

function extractTypesFromCdktfLib(libDir, opts) {
  const dirs = fs.readdirSync(libDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const types = new Set();
  for (const { name } of dirs) {
    const t = cdktfFolderToType(name, opts);
    if (t) types.add(t);
  }
  return [...types].sort();
}

function loadCatalogFromTgz(tgzPath, libSubdir = "package/lib") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cdktf-"));
  try {
    execSync(`tar -xzf "${tgzPath}" -C "${tmp}" ${libSubdir}`, { stdio: "pipe" });
    return {
      libPath: path.join(tmp, ...libSubdir.split("/")),
      tmpRoot: tmp,
    };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

function npmPack(packageSpec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-npm-pack-"));
  execSync(`npm pack ${packageSpec}`, { cwd: dir, stdio: "pipe" });
  const tgz = fs.readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack ${packageSpec} produced no .tgz`);
  return { tgzPath: path.join(dir, tgz), packDir: dir };
}

function loadPreDefaultRegexes(anchorId) {
  const raw = YAML.parse(fs.readFileSync(patternsYaml, "utf8"));
  const hints = raw.resource_type_hints ?? [];
  const out = [];
  for (const h of hints) {
    if (h.id === anchorId) break;
    if (!h.resource_type_regex) continue;
    out.push(new RegExp(h.resource_type_regex));
  }
  return out;
}

function isCoveredByHandwritten(resourceType, regexes) {
  return regexes.some((r) => {
    r.lastIndex = 0;
    return r.test(resourceType);
  });
}

/** @type {Record<string, string>} */
const AWS_SERVICE_SUBTYPE = {
  lambda: "function",
  apprunner: "service",
  batch: "container",
  beanstalk: "container",
  lightsail: "service",
  ec2: "service",
  ecr: "container",
  ecs: "container",
  eks: "container",
  elasticbeanstalk: "container",
  emr: "service",
  imagebuilder: "service",
  efs: "storage",
  fsx: "storage",
  glacier: "storage",
  s3: "storage",
  s3control: "storage",
  s3outposts: "storage",
  s3tables: "storage",
  backup: "storage",
  storagegateway: "storage",
  athena: "database",
  cloudsearch: "database",
  db: "database",
  dax: "cache",
  dynamodb: "database",
  elasticache: "cache",
  memorydb: "cache",
  neptune: "database",
  opensearch: "database",
  qldb: "database",
  rds: "database",
  redshift: "database",
  timestream: "database",
  docdb: "database",
  keyspaces: "database",
  lakeformation: "database",
  eventbridge: "queue",
  mq: "queue",
  msk: "queue",
  sns: "queue",
  sqs: "queue",
  kinesis: "queue",
  apigateway: "api",
  apigatewayv2: "api",
  appsync: "api",
  cloudfront: "api",
  globalaccelerator: "api",
  route53: "api",
  route53domains: "api",
  route53recoverycontrolconfig: "api",
  route53recoveryreadiness: "api",
  route53resolver: "api",
  vpc: "network",
  networkfirewall: "network",
  networkmanager: "network",
  cognito: "auth_service",
  iam: "auth_service",
  kms: "auth_service",
  secretsmanager: "config",
  ssm: "config",
  appconfig: "config",
  cloudformation: "config",
  cloudtrail: "config",
  cloudwatch: "config",
  config: "config",
  organizations: "config",
  elb: "network",
  elbv2: "network",
  lb: "network",
  directconnect: "network",
  dx: "network",
  glue: "database",
  kafka: "queue",
  amplify: "service",
  codebuild: "container",
  codepipeline: "container",
  mwaa: "container",
  scheduler: "queue",
  stepfunctions: "queue",
  waf: "api",
  wafv2: "api",
};

/** Heuristic subtypes for `azurerm_<service>_` (unknown → `service`). */
/** @type {Record<string, string>} */
const AZURERM_SERVICE_SUBTYPE = {
  kubernetes: "container",
  container: "container",
  containerapp: "container",
  spring: "container",
  function: "function",
  linux: "function",
  windows: "function",
  app: "service",
  web: "service",
  static: "service",
  cosmosdb: "database",
  postgresql: "database",
  mysql: "database",
  mariadb: "database",
  mssql: "database",
  sql: "database",
  synapse: "database",
  kusto: "database",
  redis: "cache",
  storage: "storage",
  servicebus: "queue",
  eventhub: "queue",
  relay: "queue",
  api: "api",
  apimanagement: "api",
  logic: "api",
  keyvault: "config",
  monitor: "config",
  policy: "config",
  resource: "application",
  resourcegroup: "application",
  subscription: "application",
  management: "application",
  network: "network",
  virtual: "network",
  lb: "network",
  dns: "network",
  private: "network",
  public: "network",
  firewall: "network",
  nat: "network",
  route: "network",
  role: "auth_service",
  user: "auth_service",
  active: "auth_service",
  automation: "config",
  sentinel: "config",
  security: "config",
  stream: "queue",
  iothub: "service",
  signalr: "service",
  bot: "service",
  cognitive: "service",
  machine: "service",
  data: "database",
  databricks: "database",
  hdinsight: "database",
  powerbi: "database",
  analysis: "database",
};

/** Heuristic subtypes for `kubernetes_<token>_` (unknown → `service`). */
/** @type {Record<string, string>} */
const KUBERNETES_SERVICE_SUBTYPE = {
  deployment: "service",
  stateful_set: "service",
  statefulset: "service",
  daemon_set: "service",
  daemonset: "service",
  job: "service",
  cron_job: "service",
  cronjob: "service",
  pod: "service",
  replicaset: "service",
  replication_controller: "service",
  service: "api",
  ingress: "api",
  ingress_class: "api",
  endpoints: "api",
  secret: "config",
  config_map: "config",
  configmap: "config",
  persistent_volume: "storage",
  persistent_volume_claim: "storage",
  storage_class: "storage",
  volume: "storage",
  namespace: "container",
  role: "auth_service",
  role_binding: "auth_service",
  cluster_role: "auth_service",
  cluster_role_binding: "auth_service",
  service_account: "auth_service",
  network_policy: "network",
  horizontal_pod_autoscaler: "service",
  vertical_pod_autoscaler: "service",
  manifest: "application",
  annotations: "config",
  labels: "config",
};

function generateAws() {
  let pathOnly;
  let packDir = null;
  if (process.env.CDKTF_PROVIDER_TGZ) {
    pathOnly = process.env.CDKTF_PROVIDER_TGZ;
  } else {
    const packed = npmPack("@cdktf/provider-aws@21.0.0");
    pathOnly = packed.tgzPath;
    packDir = packed.packDir;
  }

  const { libPath, tmpRoot } = loadCatalogFromTgz(pathOnly);
  try {
    const catalog = extractTypesFromCdktfLib(libPath, {
      dataPrefix: "data-aws-",
      resourcePrefix: "aws",
      skipDataPrefixes: ["data-awscc-"],
    });
    const generatedAt = new Date().toISOString();
    const snapshot = {
      generatedAt,
      source: "@cdktf/provider-aws@21.x (HashiCorp aws ~> 6.x)",
      resourceTypes: catalog,
    };
    fs.writeFileSync(
      path.join(patternsDir, "aws-terraform-catalog.snapshot.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );

    const preDefault = loadPreDefaultRegexes("aws_default_family");
    const tokensNeeded = new Map();
    for (const rt of catalog) {
      if (!rt.startsWith("aws_")) continue;
      if (isCoveredByHandwritten(rt, preDefault)) continue;
      const tok = serviceTokenAfterPrefix(rt, "aws");
      if (!tok) continue;
      if (!tokensNeeded.has(tok)) tokensNeeded.set(tok, new Set());
      tokensNeeded.get(tok).add(rt);
    }

    const slim = [...tokensNeeded.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([service]) => ({
        id: `gen_aws_${service}_family`,
        resource_type_regex: `^aws_${service}_`,
        componentSubType: AWS_SERVICE_SUBTYPE[service] ?? "service",
        cloud_provider: "aws",
      }));

    fs.writeFileSync(
      path.join(patternsDir, "aws-terraform-service-hints.generated.json"),
      `${JSON.stringify({ generatedAt, source: snapshot.source, hints: slim }, null, 2)}\n`,
      "utf8",
    );

    console.log(
      `AWS: ${catalog.length} resource types, ${slim.length} generated hints (before aws_default_family).`,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (packDir) {
      try {
        fs.unlinkSync(pathOnly);
        fs.rmSync(packDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function generateAzurerm() {
  let pathOnly;
  let packDir = null;
  if (process.env.CDKTF_PROVIDER_AZURERM_TGZ) {
    pathOnly = process.env.CDKTF_PROVIDER_AZURERM_TGZ;
  } else {
    const packed = npmPack("@cdktf/provider-azurerm@14.23.1");
    pathOnly = packed.tgzPath;
    packDir = packed.packDir;
  }

  const { libPath, tmpRoot } = loadCatalogFromTgz(pathOnly);
  try {
    const catalog = extractTypesFromCdktfLib(libPath, {
      dataPrefix: "data-azurerm-",
      resourcePrefix: "azurerm",
      skipDataPrefixes: [],
    });
    const generatedAt = new Date().toISOString();
    const snapshot = {
      generatedAt,
      source: "@cdktf/provider-azurerm@14.x (HashiCorp azurerm)",
      resourceTypes: catalog,
    };
    fs.writeFileSync(
      path.join(patternsDir, "azure-terraform-catalog.snapshot.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );

    const preDefault = loadPreDefaultRegexes("azurerm_default_family");
    const tokensNeeded = new Map();
    for (const rt of catalog) {
      if (!rt.startsWith("azurerm_")) continue;
      if (isCoveredByHandwritten(rt, preDefault)) continue;
      const tok = serviceTokenAfterPrefix(rt, "azurerm");
      if (!tok) continue;
      if (!tokensNeeded.has(tok)) tokensNeeded.set(tok, new Set());
      tokensNeeded.get(tok).add(rt);
    }

    const slim = [...tokensNeeded.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([service]) => ({
        id: `gen_azurerm_${service}_family`,
        resource_type_regex: `^azurerm_${service}_`,
        componentSubType: AZURERM_SERVICE_SUBTYPE[service] ?? "service",
        cloud_provider: "azure",
      }));

    fs.writeFileSync(
      path.join(patternsDir, "azure-terraform-service-hints.generated.json"),
      `${JSON.stringify({ generatedAt, source: snapshot.source, hints: slim }, null, 2)}\n`,
      "utf8",
    );

    console.log(
      `Azure: ${catalog.length} resource types, ${slim.length} generated hints (before azurerm_default_family).`,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (packDir) {
      try {
        fs.unlinkSync(pathOnly);
        fs.rmSync(packDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function generateKubernetes() {
  let pathOnly;
  let packDir = null;
  if (process.env.CDKTF_PROVIDER_KUBERNETES_TGZ) {
    pathOnly = process.env.CDKTF_PROVIDER_KUBERNETES_TGZ;
  } else {
    const packed = npmPack("@cdktf/provider-kubernetes@11.11.0");
    pathOnly = packed.tgzPath;
    packDir = packed.packDir;
  }

  const { libPath, tmpRoot } = loadCatalogFromTgz(pathOnly);
  try {
    const catalog = extractTypesFromCdktfLib(libPath, {
      dataPrefix: "data-kubernetes-",
      resourcePrefix: "kubernetes",
      skipDataPrefixes: [],
    });
    const generatedAt = new Date().toISOString();
    const snapshot = {
      generatedAt,
      source: "@cdktf/provider-kubernetes@11.x (HashiCorp kubernetes)",
      resourceTypes: catalog,
    };
    fs.writeFileSync(
      path.join(patternsDir, "kubernetes-terraform-catalog.snapshot.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );

    const preDefault = loadPreDefaultRegexes("kubernetes_default_family");
    const tokensNeeded = new Map();
    for (const rt of catalog) {
      if (!rt.startsWith("kubernetes_")) continue;
      if (isCoveredByHandwritten(rt, preDefault)) continue;
      const tok = serviceTokenAfterPrefix(rt, "kubernetes");
      if (!tok) continue;
      if (!tokensNeeded.has(tok)) tokensNeeded.set(tok, new Set());
      tokensNeeded.get(tok).add(rt);
    }

    const slim = [...tokensNeeded.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([service]) => ({
        id: `gen_kubernetes_${service}_family`,
        resource_type_regex: `^kubernetes_${service}_`,
        componentSubType: KUBERNETES_SERVICE_SUBTYPE[service] ?? "service",
        cloud_provider: "kubernetes",
      }));

    fs.writeFileSync(
      path.join(patternsDir, "kubernetes-terraform-service-hints.generated.json"),
      `${JSON.stringify({ generatedAt, source: snapshot.source, hints: slim }, null, 2)}\n`,
      "utf8",
    );

    console.log(
      `Kubernetes: ${catalog.length} resource types, ${slim.length} generated hints (before kubernetes_default_family).`,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (packDir) {
      try {
        fs.unlinkSync(pathOnly);
        fs.rmSync(packDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

function main() {
  if (runAws) generateAws();
  if (runAzure) generateAzurerm();
  if (runKubernetes) generateKubernetes();
}

main();
