import { createHash } from "crypto";

import { assignStableEntityIds, type DetectedComponent, type DetectedDataFlow, type ScanResult } from "@dataparade/scanner";

import { buildScanIdentities, dataItemIdentity, groupIdentity, numberGroupDuplicates } from "../../../src/facts/identity";
import { identitySchema } from "../../../src/facts/schema";

const ROOT = "/Users/dev/projects/shop";
const scrub = (value: string) => value.split(`${ROOT}/`).join("");

function component(partial: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">): DetectedComponent {
  return { confidence: 0.9, detectedFrom: [], sourceLocations: [], properties: {}, ...partial } as DetectedComponent;
}

function flow(partial: Partial<DetectedDataFlow> & Pick<DetectedDataFlow, "id" | "sourceComponentId" | "targetComponentId">): DetectedDataFlow {
  return { type: "api_call", confidence: 0.9, ...partial } as DetectedDataFlow;
}

/** A scan whose ids the scanner assigned, as in a real run. */
function stableScan(components: DetectedComponent[], dataFlows: DetectedDataFlow[]): ScanResult {
  return assignStableEntityIds({ components, dataFlows } as unknown as ScanResult);
}

const hash = (prefix: string, key: string) =>
  `${prefix}${createHash("sha256").update(key.replace(/#\d+$/, ""), "utf8").digest("hex").slice(0, 12)}`;

describe("buildScanIdentities", () => {
  const scan = stableScan(
    [
      component({ id: "a", name: "API ", type: "asset", subType: "service", properties: { section_id: "backend" }, sourceLocations: [{ filePath: "src/z.ts", startLine: 9, endLine: 9 }, { filePath: "src/api.ts", startLine: 1, endLine: 2 }] }),
      component({ id: "b", name: "bucket", type: "asset", subType: "object_store", properties: { terraform_address: "aws_s3_bucket.files" } }),
      component({ id: "c", name: "AWS", type: "third_party", subType: "cloud_provider", properties: { section_id: "backend" }, sourceLocations: [{ filePath: "infra/aws.ts", startLine: 1, endLine: 1 }] }),
      component({ id: "d", name: "Postgres", type: "asset", subType: "database", properties: { section_id: "backend", managed_by_provider: "c", managed_service_key: "postgres" } }),
    ],
    [flow({ id: "f", sourceComponentId: "a", targetComponentId: "d", method: "post", endpoint: "/users/", sourceLocations: [{ filePath: "src/api.ts", startLine: 5, endLine: 5 }] })],
  );
  const ids = buildScanIdentities(scan.components, scan.dataFlows, scrub);

  it("gives every component and flow an identity whose key hashes to its id", () => {
    for (const c of scan.components) {
      const identity = ids.components.get(c.id);
      expect(identitySchema.parse(identity)).toBeTruthy();
      expect(c.id).toBe(hash("cmp_", identity!.key));
    }
    for (const f of scan.dataFlows) {
      const identity = ids.dataFlows.get(f.id)!;
      expect(identity.kind).toBe("dataFlow");
      expect(f.id).toBe(hash("flow_", identity.key));
    }
  });

  it("splits component keys into parts for app, terraform and managed components", () => {
    const byName = (name: string) => ids.components.get(scan.components.find((c) => c.name === name)!.id)!;
    expect(byName("API ")).toEqual({
      kind: "component",
      key: "app:backend|asset|service|src/api.ts|api",
      parts: { scheme: "app", section: "backend", type: "asset", subType: "service", file: "src/api.ts", name: "api" },
    });
    expect(byName("bucket").parts).toEqual({ scheme: "tf", terraformAddress: "aws_s3_bucket.files" });
    expect(byName("Postgres")).toMatchObject({
      key: "managed:{app:backend|third_party|cloud_provider|infra/aws.ts|aws}|postgres|backend",
      parts: { scheme: "managed", provider: "app:backend|third_party|cloud_provider|infra/aws.ts|aws", serviceKey: "postgres", section: "backend" },
    });
  });

  it("splits flow keys into parts", () => {
    expect(ids.dataFlows.get(scan.dataFlows[0].id)!.parts).toEqual({
      source: "app:backend|asset|service|src/api.ts|api",
      target: "managed:{app:backend|third_party|cloud_provider|infra/aws.ts|aws}|postgres|backend",
      type: "api_call",
      method: "POST",
      endpoint: "/users",
      file: "src/api.ts",
    });
  });

  it("never puts the scan root or a line number in a key", () => {
    const absolute = stableScan(
      [component({ id: "a", name: "api", type: "asset", sourceLocations: [{ filePath: `${ROOT}/src/api.ts`, startLine: 42, endLine: 43 }] })],
      [],
    );
    const identity = buildScanIdentities(absolute.components, [], scrub).components.get(absolute.components[0].id)!;
    expect(identity.key).toBe("app:<unsectioned>|asset||src/api.ts|api");
    expect(identity.key).not.toContain("42");
  });

  it("numbers duplicate keys #2, #3 in the scanner's id order", () => {
    const dup = stableScan(
      [
        component({ id: "x", name: "User", type: "actor", sourceLocations: [{ filePath: "src/u.ts", startLine: 20, endLine: 20 }] }),
        component({ id: "y", name: "User", type: "actor", sourceLocations: [{ filePath: "src/u.ts", startLine: 3, endLine: 3 }] }),
        component({ id: "t", name: "Stripe", type: "third_party", sourceLocations: [{ filePath: "src/pay.ts", startLine: 1, endLine: 1 }] }),
      ],
      [
        flow({ id: "f1", sourceComponentId: "x", targetComponentId: "t", sourceLocations: [{ filePath: "src/pay.ts", startLine: 9, endLine: 9 }] }),
        flow({ id: "f2", sourceComponentId: "x", targetComponentId: "t", sourceLocations: [{ filePath: "src/pay.ts", startLine: 2, endLine: 2 }] }),
      ],
    );
    const result = buildScanIdentities(dup.components, dup.dataFlows, scrub);
    const users = dup.components.filter((c) => c.name === "User");
    const plain = users.find((c) => !/_\d+$/.test(c.id.slice(4 + 12)))!;
    const second = users.find((c) => c !== plain)!;
    expect(second.id).toBe(`${plain.id}_2`);
    expect(result.components.get(plain.id)).not.toHaveProperty("duplicateIndex");
    expect(result.components.get(second.id)).toMatchObject({ key: `${result.components.get(plain.id)!.key}#2`, duplicateIndex: 2 });
    // The earlier source position keeps the plain id and key.
    expect(plain.sourceLocations?.[0].startLine).toBe(3);

    const flows = [...dup.dataFlows].sort((a, b) => a.id.localeCompare(b.id));
    expect(flows[1].id).toBe(`${flows[0].id}_2`);
    expect(result.dataFlows.get(flows[0].id)).not.toHaveProperty("duplicateIndex");
    expect(result.dataFlows.get(flows[1].id)).toMatchObject({ duplicateIndex: 2 });
    expect(result.dataFlows.get(flows[1].id)!.key.endsWith("#2")).toBe(true);
  });
  it("does not take a name ending in #<digits> for a duplicate", () => {
    const one = stableScan([component({ id: "w", name: "Worker #2", type: "asset", sourceLocations: [{ filePath: "src/w.ts", startLine: 1, endLine: 1 }] })], []);
    const identity = buildScanIdentities(one.components, [], scrub).components.get(one.components[0].id)!;
    expect(identity).not.toHaveProperty("duplicateIndex");
    expect(identity.key).toBe("app:<unsectioned>|asset||src/w.ts|worker #2");
    expect(one.components[0].id).toBe(`cmp_${createHash("sha256").update(identity.key, "utf8").digest("hex").slice(0, 12)}`);
  });

  it("puts the provider's base key, without #n, in a managed component's parts", () => {
    const scan = stableScan(
      [
        component({ id: "p1", name: "AWS", type: "third_party", sourceLocations: [{ filePath: "infra/aws.ts", startLine: 1, endLine: 1 }] }),
        component({ id: "p2", name: "AWS", type: "third_party", sourceLocations: [{ filePath: "infra/aws.ts", startLine: 9, endLine: 9 }] }),
        component({ id: "db", name: "Postgres", type: "asset", properties: { managed_by_provider: "p2", managed_service_key: "postgres" } }),
      ],
      [],
    );
    const ids = buildScanIdentities(scan.components, [], scrub);
    const db = scan.components.find((c) => c.name === "Postgres")!;
    const identity = ids.components.get(db.id)!;
    expect(identity.parts.provider).toBe("app:<unsectioned>|third_party||infra/aws.ts|aws");
    expect(identity.key).toBe(`managed:{${identity.parts.provider}}|postgres|<unsectioned>`);
    expect(db.id).toBe(hash("cmp_", identity.key));
  });
});

describe("root Application named after the scan folder (DATAP-858)", () => {
  it("keys it by the <project> token, in the key and in parts", () => {
    const scan = stableScan(
      [component({ id: "r", name: "my-checkout", type: "asset", subType: "application", properties: { section_id: "root", name_from_project: true } })],
      [],
    );
    const identity = buildScanIdentities(scan.components, [], scrub).components.get(scan.components[0].id)!;
    expect(identity.key).toBe("app:root|asset|application||<project>");
    expect(identity.parts.name).toBe("<project>");
    expect(scan.components[0].id).toBe(hash("cmp_", identity.key));
  });
});

describe("data item and group identities", () => {
  it("keys a data item by its name", () => {
    expect(dataItemIdentity("Credit Card")).toEqual({ kind: "dataItem", key: "Credit Card", parts: { name: "Credit Card" } });
  });

  it("splits group ids into the data item and the qualifier or column", () => {
    expect(groupIdentity("email", "email:customer")).toEqual({ kind: "group", key: "email:customer", parts: { dataItem: "email", qualifier: "customer" } });
    expect(groupIdentity("email", "email@contact_email")).toEqual({ kind: "group", key: "email@contact_email", parts: { dataItem: "email", column: "contact_email" } });
    expect(groupIdentity("email", "other")).toEqual({ kind: "group", key: "other", parts: { dataItem: "email", group: "other" } });
  });

  it("drops the line from a declaration-named group", () => {
    expect(groupIdentity("email", "email@src/a.js:12#email")).toEqual({
      kind: "group",
      key: "email@src/a.js#email",
      parts: { dataItem: "email", declarationFile: "src/a.js", declarationName: "email" },
    });
    expect(groupIdentity("email", "email@src/a.js:12")).toEqual({ kind: "group", key: "email@src/a.js", parts: { dataItem: "email", declarationFile: "src/a.js" } });
  });

  it("numbers groups that share a key by declaration line", () => {
    const pairs: Array<[string, ReturnType<typeof groupIdentity>]> = ["email@a.js:40", "email@a.js:5", "email:staff"].map((id) => [id, groupIdentity("email", id)]);
    expect(numberGroupDuplicates(pairs).map((i) => [i.key, i.duplicateIndex])).toEqual([
      ["email@a.js#2", 2],
      ["email@a.js", undefined],
      ["email:staff", undefined],
    ]);
  });
});
