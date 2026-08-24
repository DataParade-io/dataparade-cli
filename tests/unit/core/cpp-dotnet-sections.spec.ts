import fs from "fs";
import os from "os";
import path from "path";

import { discoverServiceSections } from "../../../src/core/sectioning/discover-service-sections";

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("service sections - C++ and .NET manifests", () => {
  it("registers a section per .NET project file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-dotnet-sections-"));
    try {
      write(
        path.join(root, "src", "Billing.Api", "Billing.Api.csproj"),
        '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>',
      );
      write(
        path.join(root, "src", "Billing.Worker", "Billing.Worker.csproj"),
        '<Project Sdk="Microsoft.NET.Sdk.Worker"></Project>',
      );

      const { sections } = await discoverServiceSections(root);
      const serviceDirs = sections
        .filter((section) => section.role === "service")
        .map((section) => section.sectionDir)
        .sort();

      expect(serviceDirs).toEqual(["src/Billing.Api", "src/Billing.Worker"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers a section for C++ package manifests but not for nested CMakeLists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-cpp-sections-"));
    try {
      write(
        path.join(root, "services", "gateway", "vcpkg.json"),
        JSON.stringify({ name: "gateway", dependencies: ["curl"] }),
      );
      write(
        path.join(root, "services", "gateway", "src", "CMakeLists.txt"),
        "add_library(gateway_core core.cpp)",
      );

      const { sections } = await discoverServiceSections(root);
      const serviceDirs = sections
        .filter((section) => section.role === "service")
        .map((section) => section.sectionDir);

      expect(serviceDirs).toEqual(["services/gateway"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
