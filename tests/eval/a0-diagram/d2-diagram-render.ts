import type { DiagramGraphJsonSchema } from "../../../src/core/schema/diagram-graph.schema";
import type { SlotStatus } from "./a0-diagram-projector";

function readSlotStatus(data: Record<string, unknown> | undefined): SlotStatus {
  const privacy = data?.privacy as { slotStatus?: SlotStatus } | undefined;
  return privacy?.slotStatus ?? "known";
}

function d2StrokeStyle(status: SlotStatus): string {
  if (status === "unknown") {
    return "stroke-dash: 5";
  }
  return "";
}

function d2NodeLabel(node: DiagramGraphJsonSchema["nodes"][number]): string {
  const label = String(node.data.label ?? node.id);
  const status = readSlotStatus(node.data as Record<string, unknown>);
  if (status === "partial") {
    return `${label}\\n[partial]`;
  }
  if (status === "unknown") {
    return `${label}\\n[?]`;
  }
  return label;
}

export function renderDiagramToD2(graph: DiagramGraphJsonSchema): string {
  const lines: string[] = ["direction: right", ""];

  for (const node of graph.nodes) {
    const status = readSlotStatus(node.data as Record<string, unknown>);
    const style = d2StrokeStyle(status);
    const shape = node.type === "system" ? "shape: rectangle" : "";
    const styleBlock = [shape, style].filter(Boolean).join("; ");
    const attrs = styleBlock ? ` {\n  ${styleBlock}\n}` : "";
    lines.push(`${node.id}: ${d2NodeLabel(node)}${attrs}`);
  }

  lines.push("");
  for (const edge of graph.edges) {
    const status = readSlotStatus(edge.data as Record<string, unknown>);
    const label = edge.data?.label ?? "";
    const style = d2StrokeStyle(status);
    if (style || label) {
      lines.push(`${edge.source} -> ${edge.target}: ${label} {`);
      if (style) {
        lines.push(`  style.${style}`);
      }
      lines.push("}");
    } else {
      lines.push(`${edge.source} -> ${edge.target}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function strokeDash(status: SlotStatus): string {
  return status === "unknown" ? ' stroke-dasharray="6 4"' : "";
}

function strokeColor(status: SlotStatus): string {
  return status === "unknown" ? ' stroke="#d97706"' : ' stroke="#334155"';
}

function fillForNode(type: string): string {
  if (type === "system") {
    return "#e0f2fe";
  }
  if (type === "actor") {
    return "#fef3c7";
  }
  return "#f8fafc";
}

/** Inline SVG renderer (D2 visual language; no headless RF / d2 binary required). */
export function renderDiagramToSvg(graph: DiagramGraphJsonSchema): string {
  const width = 1200;
  const height = 800;
  const edgePaths: string[] = [];
  const edgeLabels: string[] = [];
  const nodeRects: string[] = [];
  const nodeLabels: string[] = [];

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      continue;
    }
    const sx = source.position.x + 90;
    const sy = source.position.y + 28;
    const tx = target.position.x + 10;
    const ty = target.position.y + 28;
    const status = readSlotStatus(edge.data as Record<string, unknown>);
    edgePaths.push(
      `<path d="M ${sx} ${sy} C ${sx + 60} ${sy}, ${tx - 60} ${ty}, ${tx} ${ty}" fill="none"${strokeColor(status)}${strokeDash(status)} stroke-width="2"/>`,
    );
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2 - 8;
    const label = edge.data?.label ?? "";
    edgeLabels.push(
      `<text x="${mx}" y="${my}" text-anchor="middle" font-size="11" fill="${status === "unknown" ? "#b45309" : "#334155"}">${escapeXml(label)}</text>`,
    );
  }

  for (const node of graph.nodes) {
    const status = readSlotStatus(node.data as Record<string, unknown>);
    const x = node.position.x;
    const y = node.position.y;
    nodeRects.push(
      `<rect x="${x}" y="${y}" width="180" height="56" rx="8" fill="${fillForNode(node.type)}"${strokeColor(status)}${strokeDash(status)} stroke-width="2"/>`,
    );
    nodeLabels.push(
      `<text x="${x + 90}" y="${y + 32}" text-anchor="middle" font-size="13" font-weight="600" fill="#0f172a">${escapeXml(String(node.data.label ?? node.id))}</text>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g>${edgePaths.join("\n")}${edgeLabels.join("\n")}</g>
  <g>${nodeRects.join("\n")}${nodeLabels.join("\n")}</g>
</svg>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
