import type { DetectedComponent } from "../../../src/core/types/component";
import { INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT } from "../../../src/classifier/application-injection";
import {
  enhanceComponent,
  enhanceComponents,
} from "../../../src/classifier/enhance";

function makeComponent(
  overrides: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    subType: overrides.subType,
    confidence: overrides.confidence ?? 0.9,
    detectedFrom: overrides.detectedFrom ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    properties: overrides.properties ?? {},
    description: overrides.description,
    dataFlowIds: overrides.dataFlowIds,
  };
}

describe("classifier/enhance - DP-P0-CLI-203", () => {
  it("applies all Engineering, Privacy, and Security property defaults for asset", () => {
    const comp = enhanceComponent(
      makeComponent({
        id: "c1",
        name: "postgres",
        type: "asset",
        subType: "database",
        properties: {},
      }),
    );
    expect(comp.properties.cloud_provider).toBeDefined();
    expect(comp.properties.technology_stack).toBe("postgres");
    expect(comp.properties.data_categories).toEqual([]);
    expect(comp.properties.data_subject_categories).toEqual([]);
    expect(comp.properties.encrypt_at_rest).toBeDefined();
    expect(comp.properties.audit_logging_enabled).toBe(false);
    expect(comp.properties.risk_rating).toBeDefined();
  });

  it("applies all Engineering, Privacy, and Security property defaults for third_party", () => {
    const comp = enhanceComponent(
      makeComponent({
        id: "c1",
        name: "Stripe",
        type: "third_party",
        subType: "payment_processor",
        properties: {},
      }),
    );
    expect(comp.properties.integration_method).toBe("api");
    expect(comp.properties.hosting_type).toBe("saas");
    expect(comp.properties.gdpr_role).toBeDefined();
    expect(comp.properties.compliance_certifications).toEqual([]);
    expect(comp.properties.risk_rating).toBeDefined();
  });

  it("applies all Engineering, Privacy, and Security property defaults for actor", () => {
    const comp = enhanceComponent(
      makeComponent({
        id: "c1",
        name: "Customer",
        type: "actor",
        subType: "customer",
        properties: {},
      }),
    );
    expect(comp.properties.actions).toEqual([]);
    expect(comp.properties.processing_purpose).toEqual([]);
    expect(comp.properties.isDataSubject).toBe(true);
    expect(comp.properties.risk_rating).toBeDefined();
  });

  it("sets technology_stack from properties.databaseType when missing", () => {
    const component = makeComponent({
      id: "cmp_1",
      name: "postgres",
      type: "asset",
      subType: "database",
      properties: { databaseType: "postgres" },
    });

    const result = enhanceComponent(component);

    expect(result.properties.technology_stack).toBe("postgres");
  });

  it("leaves technology_stack unset when only subType is database (no specific product)", () => {
    const component = makeComponent({
      id: "cmp_1",
      name: "my-db",
      type: "asset",
      subType: "database",
      properties: {},
    });

    const result = enhanceComponent(component);

    expect(result.properties.technology_stack).toBeNull();
  });

  it("does not overwrite existing technology_stack", () => {
    const component = makeComponent({
      id: "cmp_1",
      name: "db",
      type: "asset",
      subType: "database",
      properties: { technology_stack: "postgres", databaseType: "postgres" },
    });

    const result = enhanceComponent(component);

    expect(result.properties.technology_stack).toBe("postgres");
  });

  it("sets hosting_type for third_party when not set", () => {
    const component = makeComponent({
      id: "cmp_1",
      name: "Stripe",
      type: "third_party",
      subType: "payment_processor",
      properties: {},
    });

    const result = enhanceComponent(component);

    expect(result.properties.hosting_type).toBe("saas");
  });

  it("does not overwrite existing hosting_type for third_party", () => {
    const component = makeComponent({
      id: "cmp_1",
      name: "Stripe",
      type: "third_party",
      subType: "payment_processor",
      properties: { hosting_type: "cloud" },
    });

    const result = enhanceComponent(component);

    expect(result.properties.hosting_type).toBe("cloud");
  });

  it("sets isMainApplication on first api/service asset in enhanceComponents", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "DB",
        type: "asset",
        subType: "database",
        properties: {},
      }),
      makeComponent({
        id: "cmp_2",
        name: "App API",
        type: "asset",
        subType: "api",
        properties: {},
      }),
      makeComponent({
        id: "cmp_3",
        name: "Other Service",
        type: "asset",
        subType: "service",
        properties: {},
      }),
    ];

    const result = enhanceComponents(components);

    const apiComp = result.find((c) => c.id === "cmp_2");
    const serviceComp = result.find((c) => c.id === "cmp_3");

    expect(apiComp?.properties.isMainApplication).toBe(true);
    expect(serviceComp?.properties.isMainApplication).toBeUndefined();
  });

  it("sets isMainApplication per section_id (not globally) when multiple api/service assets exist", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "API A",
        type: "asset",
        subType: "api",
        properties: { section_id: "s1" },
      }),
      makeComponent({
        id: "cmp_2",
        name: "API B",
        type: "asset",
        subType: "api",
        properties: { section_id: "s2" },
      }),
    ];

    const result = enhanceComponents(components);

    const withMain = result.filter((c) => c.properties.isMainApplication === true);
    expect(withMain.length).toBe(2);
    expect(withMain.map((c) => c.id).sort()).toEqual(["cmp_1", "cmp_2"]);
  });

  it("prefers merged HTTP API (express) over outbound https URL api assets", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_http",
        name: "HTTP API",
        type: "asset",
        subType: "api",
        properties: { framework: "express", path: ["/auth"] },
      }),
      makeComponent({
        id: "cmp_vendor",
        name: "https://vendor.example/v1",
        type: "asset",
        subType: "api",
        properties: {
          url: "https://vendor.example/v1",
          client: "fetch",
        },
      }),
    ];

    const result = enhanceComponents(components);
    const main = result.find((c) => c.properties.isMainApplication === true);
    expect(main?.id).toBe("cmp_http");
  });

  it("does not promote Terraform module call shells to isMainApplication", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_mod",
        name: "Module · aurora",
        type: "asset",
        subType: "application",
        properties: {
          section_id: "root",
          terraform_address: "module.aurora",
        },
      }),
    ];

    const result = enhanceComponents(components);
    expect(result[0].properties.isMainApplication).toBeUndefined();
  });

  it("does not promote Terraform VPC networking to isMainApplication", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_vpc",
        name: "main (aws_vpc)",
        type: "asset",
        subType: "application",
        properties: {
          section_id: "root",
          resource_type: "aws_vpc",
          terraform_address: "module.vpc.aws_vpc.main",
        },
      }),
    ];

    const result = enhanceComponents(components);
    expect(result[0].properties.isMainApplication).toBeUndefined();
  });

  it("prefers injected project placeholder over other service assets in the same section", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_ecs",
        name: "API",
        type: "asset",
        subType: "service",
        properties: { section_id: "root" },
      }),
      makeComponent({
        id: "cmp_inj",
        name: "MyProject",
        type: "asset",
        subType: "application",
        properties: {
          section_id: "root",
          sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
        },
      }),
    ];

    const result = enhanceComponents(components);
    const mains = result.filter((c) => c.properties.isMainApplication === true);
    expect(mains.length).toBe(1);
    expect(mains[0].id).toBe("cmp_inj");
  });

  it("does not set isMainApplication when no api/service asset exists", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "DB",
        type: "asset",
        subType: "database",
        properties: {},
      }),
    ];

    const result = enhanceComponents(components);

    expect(result[0].properties.isMainApplication).toBeUndefined();
  });

  it("normalizes generic api asset name to API in enhanceComponents", () => {
    const components: DetectedComponent[] = [
      makeComponent({
        id: "cmp_1",
        name: "Route Handler",
        type: "asset",
        subType: "api",
        properties: {},
      }),
    ];

    const result = enhanceComponents(components);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("API");
  });

  describe("asset: all properties", () => {
    it("sets hosting_type to cloud for api/database assets", () => {
      const apiComp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "api",
          type: "asset",
          subType: "api",
          properties: {},
        }),
      );
      const dbComp = enhanceComponent(
        makeComponent({
          id: "c2",
          name: "db",
          type: "asset",
          subType: "database",
          properties: {},
        }),
      );
      expect(apiComp.properties.hosting_type).toBe("cloud");
      expect(dbComp.properties.hosting_type).toBe("cloud");
    });

    it("sets hosting_type to on_premise for config assets", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "config",
          type: "asset",
          subType: "config",
          properties: {},
        }),
      );
      expect(comp.properties.hosting_type).toBe("on_premise");
    });

    it("sets database_engine from databaseType for database subType", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "pg",
          type: "asset",
          subType: "database",
          properties: { databaseType: "postgres" },
        }),
      );
      expect(comp.properties.database_engine).toBe("Postgres");
    });

    it("sets supported_operations for database and api assets", () => {
      const dbComp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "db",
          type: "asset",
          subType: "database",
          properties: {},
        }),
      );
      const apiComp = enhanceComponent(
        makeComponent({
          id: "c2",
          name: "api",
          type: "asset",
          subType: "api",
          properties: {},
        }),
      );
      expect(dbComp.properties.supported_operations).toEqual([
        "read",
        "write",
        "query",
      ]);
      expect(apiComp.properties.supported_operations).toEqual([
        "read",
        "write",
        "query",
        "execute",
      ]);
    });
  });

  describe("third_party: all properties", () => {
    it("sets integration_method to api", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "Stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: {},
        }),
      );
      expect(comp.properties.integration_method).toBe("api");
    });

    it("sets vendor from component name (title case)", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: {},
        }),
      );
      expect(comp.properties.vendor).toBe("Stripe");
    });

    it("does not overwrite existing vendor", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "stripe",
          type: "third_party",
          subType: "payment_processor",
          properties: { vendor: "Stripe Inc." },
        }),
      );
      expect(comp.properties.vendor).toBe("Stripe Inc.");
    });
  });

  describe("actor: all properties", () => {
    it("sets isDataSubject to true for customer subType", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "Customer",
          type: "actor",
          subType: "customer",
          properties: {},
        }),
      );
      expect(comp.properties.isDataSubject).toBe(true);
    });

    it("does not set isDataSubject to true for non-customer actor (default remains false)", () => {
      const comp = enhanceComponent(
        makeComponent({
          id: "c1",
          name: "Employee",
          type: "actor",
          subType: "employee",
          properties: {},
        }),
      );
      expect(comp.properties.isDataSubject).toBe(false);
    });
  });
});
