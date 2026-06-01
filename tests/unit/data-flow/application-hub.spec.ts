import type { DetectedComponent } from "../../../src/core/types/component";
import { findApplicationHubForFlows } from "../../../src/data-flow/application-hub";

function asset(
  id: string,
  props: Record<string, unknown>,
  subType = "application",
): DetectedComponent {
  return {
    id,
    name: id,
    type: "asset",
    subType,
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [],
    properties: props,
  };
}

describe("findApplicationHubForFlows", () => {
  it("prefers non-Terraform main over heroku_app for the same section", () => {
    const expressMain = asset(
      "express",
      { section_id: "root", isMainApplication: true },
      "api",
    );
    const herokuApp = asset(
      "heroku",
      {
        section_id: "root",
        isMainApplication: true,
        terraform_address: "heroku_app.example",
        resource_type: "heroku_app",
      },
      "application",
    );
    const components = [expressMain, herokuApp];
    expect(findApplicationHubForFlows(components, "root")?.id).toBe("express");
  });

  it("for Terraform-only section, picks Express main in another section before heroku_app", () => {
    const herokuApp = asset(
      "heroku",
      {
        section_id: "root",
        isMainApplication: true,
        terraform_address: "heroku_app.example",
        resource_type: "heroku_app",
      },
      "application",
    );
    const expressMain = asset(
      "app",
      { section_id: "app", isMainApplication: true },
      "api",
    );
    const components = [herokuApp, expressMain];
    expect(findApplicationHubForFlows(components, "root")?.id).toBe("app");
  });

  it("falls back to heroku_app when it is the only main", () => {
    const herokuApp = asset(
      "heroku",
      {
        section_id: "root",
        isMainApplication: true,
        terraform_address: "heroku_app.example",
        resource_type: "heroku_app",
      },
      "application",
    );
    expect(findApplicationHubForFlows([herokuApp], "root")?.id).toBe("heroku");
  });
});
