import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import {
  assignStableComponentIds,
  stableComponentKey,
} from "../../../src/core/pipeline/stable-component-ids";
import { testAsset as asset } from "../../helpers/scan-result-builders";

function idsOf(components: DetectedComponent[]): string[] {
  return [...components].sort((a, b) => a.id.localeCompare(b.id)).map((c) => c.id);
}

describe("stable-component-ids", () => {
  it("stableComponentKey prefers terraform_address then managed tuple then app tuple", () => {
    expect(
      stableComponentKey(
        asset("x", "RDS", {
          terraform_address: "module.db.aws_db_instance.main",
          section_id: "terraform",
        }),
      ),
    ).toBe("tf:module.db.aws_db_instance.main");

    expect(
      stableComponentKey(
        asset("x", "S3", {
          managed_by_provider: "cmp_aws",
          managed_service_key: "s3",
          section_id: "root",
        }),
      ),
    ).toBe("managed:cmp_aws|s3|root");

    expect(
      stableComponentKey(
        asset("x", "API", { section_id: "reedy" }, "api"),
      ),
    ).toBe("app:reedy|asset|api||api");
  });

  it("assigns identical cmp_* ids for the same logical components in different insertion order", () => {
    const apiA = asset("cmp_99", "API", { section_id: "reedy", isSectionApiNode: true }, "api");
    const providerA = {
      id: "tp_aws",
      name: "AWS",
      type: "third_party" as const,
      subType: "cloud_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        terraform_address: "provider.aws",
        section_id: "terraform",
      },
    };
    const modA = asset("cmp_50", "Module · db", {
      terraform_address: "module.db",
      section_id: "terraform",
    });

    const order1: DetectedComponent[] = [apiA, providerA, modA];
    const order2: DetectedComponent[] = [modA, providerA, apiA];

    const out1 = assignStableComponentIds(order1, []);
    const out2 = assignStableComponentIds(order2, []);

    expect(idsOf(out1.components)).toEqual(idsOf(out2.components));
    expect(out1.components.find((c) => c.properties.terraform_address === "provider.aws")?.id).toBe(
      out2.components.find((c) => c.properties.terraform_address === "provider.aws")?.id,
    );
    expect(out1.components.find((c) => c.subType === "api")?.id).toBe(
      out2.components.find((c) => c.subType === "api")?.id,
    );
  });

  it("adding a TF-only component does not change ids of unchanged app components", () => {
    const api = asset("cmp_z", "API", { section_id: "root", isSectionApiNode: true }, "api");
    const provider = {
      id: "cmp_aws",
      name: "AWS",
      type: "third_party" as const,
      subType: "cloud_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: { terraform_address: "provider.aws", section_id: "terraform" },
    };
    const mod = asset("cmp_mod", "Module · db", {
      terraform_address: "module.db",
      section_id: "terraform",
    });

    const base = assignStableComponentIds([api, provider, mod], []);
    const apiIdBefore = base.components.find((c) => c.subType === "api")?.id;

    const innerRds = asset("cmp_rds", "RDS", {
      section_id: "terraform",
      terraform_address: "module.db.aws_db_instance.main",
      resource_type: "aws_db_instance",
    });

    const withExtra = assignStableComponentIds([api, provider, mod, innerRds], []);

    expect(withExtra.components.find((c) => c.subType === "api")?.id).toBe(apiIdBefore);
    expect(
      withExtra.components.find(
        (c) => c.properties.terraform_address === "module.db.aws_db_instance.main",
      )?.id,
    ).toMatch(/^cmp_\d+$/);
    expect(withExtra.components.some((c) => c.id === "cmp_rds")).toBe(false);
  });

  it("rewrites dataFlows and managed_by_provider references", () => {
    const provider = {
      id: "cmp_old_aws",
      name: "AWS",
      type: "third_party" as const,
      subType: "cloud_provider",
      confidence: 0.9,
      detectedFrom: [],
      sourceLocations: [],
      properties: { terraform_address: "provider.aws", section_id: "root" },
    };
    const managed = asset("cmp_old_s3", "S3", {
      terraform_address: "aws_s3_bucket.x",
      managed_by_provider: "cmp_old_aws",
      managed_service_key: "s3",
      section_id: "root",
    });
    const flows: DetectedDataFlow[] = [
      {
        id: "flow_1",
        sourceComponentId: "cmp_old_aws",
        targetComponentId: "cmp_old_s3",
        type: "file_transfer",
        confidence: 0.8,
      },
    ];

    const out = assignStableComponentIds([managed, provider], flows);
    const newProviderId = out.components.find(
      (c) => c.properties.terraform_address === "provider.aws",
    )?.id;
    const newManagedId = out.components.find(
      (c) => c.properties.managed_service_key === "s3",
    )?.id;

    expect(newProviderId).toMatch(/^cmp_\d+$/);
    expect(newManagedId).toMatch(/^cmp_\d+$/);
    expect(out.components.find((c) => c.properties.managed_service_key === "s3")?.properties
      .managed_by_provider).toBe(newProviderId);
    expect(out.dataFlows[0]?.sourceComponentId).toBe(newProviderId);
    expect(out.dataFlows[0]?.targetComponentId).toBe(newManagedId);
  });
});
