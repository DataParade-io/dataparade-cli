import {
  clearTerraformPatternConfigCache,
  loadTerraformPatternConfig,
  lookupTerraformResourceHints,
} from "../../../../src/analyzers/terraform/terraform-detection-config";

describe("terraform CDKTF-generated service-prefix hints", () => {
  beforeEach(() => {
    clearTerraformPatternConfigCache();
  });

  describe("AWS (@cdktf/provider-aws)", () => {
    it("classifies a resource only covered by generated aws_<svc>_ hints", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("aws_accessanalyzer_analyzer", cfg);
      expect(h.cloud_provider).toBe("aws");
      expect(h.componentSubType).toBe("service");
    });

    it("still prefers hand-written rules before generated + aws_default", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("aws_s3_bucket", cfg);
      expect(h.componentSubType).toBe("storage");
    });
  });

  describe("Azure (@cdktf/provider-azurerm)", () => {
    it("classifies a resource only covered by generated azurerm_<svc>_ hints", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("azurerm_analysis_services_server", cfg);
      expect(h.cloud_provider).toBe("azure");
      expect(h.componentSubType).toBe("database");
    });

    it("still prefers hand-written rules before generated + azurerm_default", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("azurerm_storage_account", cfg);
      expect(h.componentSubType).toBe("storage");
    });
  });

  describe("Kubernetes (@cdktf/provider-kubernetes)", () => {
    it("classifies a resource only covered by generated kubernetes_<svc>_ hints", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("kubernetes_horizontal_pod_autoscaler_v2", cfg);
      expect(h.cloud_provider).toBe("kubernetes");
      expect(h.componentSubType).toBe("service");
    });

    it("still prefers hand-written rules before generated + kubernetes_default", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("kubernetes_deployment", cfg);
      expect(h.componentSubType).toBe("service");
      expect(h.cloud_provider).toBe("kubernetes");
    });

    it("classifies kubernetes_service as api via hand-written rule", () => {
      const cfg = loadTerraformPatternConfig();
      const h = lookupTerraformResourceHints("kubernetes_service", cfg);
      expect(h.componentSubType).toBe("api");
    });
  });
});
