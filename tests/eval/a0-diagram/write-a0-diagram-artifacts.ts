import fs from "fs";
import path from "path";

import type { DataflowWrapperSchema } from "../../../src/core/schema/dataflow-wrapper.schema";
import { renderDiagramToD2, renderDiagramToSvg } from "./d2-diagram-render";

export interface WriteA0DiagramArtifactsOptions {
  wrapper: DataflowWrapperSchema;
  outputDir: string;
  basename: string;
}

export function writeA0DiagramArtifacts(options: WriteA0DiagramArtifactsOptions): {
  dataflowPath: string;
  d2Path: string;
  svgPath: string;
} {
  const outputDir = path.resolve(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const dataflowPath = path.join(outputDir, `${options.basename}.dataflow.json`);
  const d2Path = path.join(outputDir, `${options.basename}.d2`);
  const svgPath = path.join(outputDir, `${options.basename}.svg`);

  fs.writeFileSync(dataflowPath, `${JSON.stringify(options.wrapper, null, 2)}\n`, "utf8");
  fs.writeFileSync(d2Path, renderDiagramToD2(options.wrapper.graph), "utf8");
  fs.writeFileSync(svgPath, renderDiagramToSvg(options.wrapper.graph), "utf8");

  return { dataflowPath, d2Path, svgPath };
}
