import fs from "fs";
import path from "path";

import type { DataflowWrapperSchema } from "../../../src/core/schema/dataflow-wrapper.schema";
import type { A0DiscoveriesDocument } from "./a0-discoveries-document.schema";
import { renderDiagramToD2, renderDiagramToSvg } from "./d2-diagram-render";

export interface WriteA0DiagramArtifactsOptions {
  discoveriesDocument: A0DiscoveriesDocument;
  diagramWrapper: DataflowWrapperSchema;
  outputDir: string;
  basename: string;
}

export function writeA0DiagramArtifacts(options: WriteA0DiagramArtifactsOptions): {
  dataflowPath: string;
  diagramPath: string;
  d2Path: string;
  svgPath: string;
} {
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const dataflowPath = path.join(outputDir, `${options.basename}.dataflow.json`);
  const diagramPath = path.join(outputDir, `${options.basename}.diagram.json`);
  const d2Path = path.join(outputDir, `${options.basename}.d2`);
  const svgPath = path.join(outputDir, `${options.basename}.svg`);

  fs.writeFileSync(
    dataflowPath,
    `${JSON.stringify(options.discoveriesDocument, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(diagramPath, `${JSON.stringify(options.diagramWrapper, null, 2)}\n`, "utf8");
  fs.writeFileSync(d2Path, renderDiagramToD2(options.diagramWrapper.graph), "utf8");
  fs.writeFileSync(svgPath, renderDiagramToSvg(options.diagramWrapper.graph), "utf8");

  return { dataflowPath, diagramPath, d2Path, svgPath };
}
