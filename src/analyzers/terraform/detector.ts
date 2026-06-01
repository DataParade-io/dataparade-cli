import type { FileInfo } from "../../core/types/file";
import type { RawFinding } from "../../core/types/detection";
import type { TerraformPatternConfig } from "./terraform-detection-config";
import {
  lookupTerraformProviderServiceName,
  lookupTerraformResourceHints,
} from "./terraform-detection-config";
import {
  blockSourceLocation,
  extractTerraformReferences,
  lineBeforeHashComment,
  parseTerraformFile,
  sectionIdFromFilePath,
  sectionLabelFromFilePath,
} from "./parser";
import type { ParsedTerraformBlock } from "./parser";
import { isTerraformOmittedFromServiceGraphResourceType } from "./terraform-utility-resource";
import type { TerraformModuleCallManifest } from "./terraform-module-manifest";
import { moduleInstancePrefixesForFile } from "./terraform-module-manifest";

function findSatelliteParentAddress(
  block: ParsedTerraformBlock,
  config: TerraformPatternConfig,
): string | undefined {
  const rt = block.resourceType ?? "";
  if (!rt) return undefined;

  for (const rule of config.satelliteRules) {
    if (!rule.childResourceTypeRegex.test(rt)) continue;
    const lines = block.bodyText.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = lineBeforeHashComment(line).trim();
      const m = rule.parentLineRegex.exec(trimmed);
      const g = m?.[rule.parentCaptureGroup];
      if (typeof g === "string" && g.trim()) {
        return g.trim();
      }
    }
  }
  return undefined;
}

const RESERVED_REF_FIRST = new Set([
  "module",
  "data",
  "provider",
  "var",
  "local",
  "each",
  "path",
  "terraform",
  "count",
]);

/**
 * Prefix a `type.name[...]` reference when it refers to another resource in the
 * same module instance (not already absolute with `module.` / `data.` / …).
 */
function qualifyTerraformReference(ref: string, instancePrefix: string): string {
  if (!instancePrefix) return ref;
  const first = (ref.split(".")[0] ?? "").toLowerCase();
  if (RESERVED_REF_FIRST.has(first)) return ref;
  const parts = ref.split(".").filter(Boolean);
  if (parts.length < 2) return ref;
  return `${instancePrefix}.${parts[0]}.${parts[1]}`;
}

function qualifyTerraformAddress(
  logicalAddress: string,
  instancePrefix: string,
): string {
  if (!instancePrefix) return logicalAddress;
  return `${instancePrefix}.${logicalAddress}`;
}

export interface DetectTerraformPatternsOptions {
  manifest?: TerraformModuleCallManifest;
  /** Scan root path (same as CLI scan target); required when manifest is set */
  scanRootPath?: string;
}

export function detectTerraformPatterns(
  file: FileInfo,
  config: TerraformPatternConfig,
  opts?: DetectTerraformPatternsOptions,
): RawFinding[] {
  if (file.language !== "terraform") return [];

  const { blocks } = parseTerraformFile(file, config);
  const findings: RawFinding[] = [];
  const sectionId = sectionIdFromFilePath(file.path);
  const sectionLabel = sectionLabelFromFilePath(file.path);

  const manifest = opts?.manifest;
  const scanRoot = opts?.scanRootPath;
  const instancePrefixes =
    manifest && scanRoot
      ? moduleInstancePrefixesForFile(manifest, scanRoot, file.path)
      : [];

  const passes =
    instancePrefixes.length > 0 ? instancePrefixes : [""];

  const emitModuleAndProvider = instancePrefixes.length === 0;

  for (const instancePrefix of passes) {
    const q = (addr: string) => qualifyTerraformAddress(addr, instancePrefix);

    const addressSet = new Set(blocks.map((b) => q(b.address)));
    const omittedTerraformAddresses = new Set<string>();
    for (const block of blocks) {
      if (block.kind !== "resource" && block.kind !== "data") continue;
      const rt = block.resourceType ?? "";
      if (rt && isTerraformOmittedFromServiceGraphResourceType(rt)) {
        omittedTerraformAddresses.add(q(block.address));
      }
    }

    const satelliteChildAddresses = new Set<string>();
    const satelliteParentByChild = new Map<string, string>();

    for (const block of blocks) {
      if (block.kind !== "resource" && block.kind !== "data") continue;
      const parentAddr = findSatelliteParentAddress(block, config);
      if (parentAddr && addressSet.has(q(parentAddr))) {
        satelliteChildAddresses.add(q(block.address));
        satelliteParentByChild.set(q(block.address), q(parentAddr));
      }
    }

    const satellitesByParent = new Map<string, ParsedTerraformBlock[]>();
    for (const block of blocks) {
      const qa = q(block.address);
      if (!satelliteChildAddresses.has(qa)) continue;
      const parentAddr = satelliteParentByChild.get(qa);
      if (!parentAddr) continue;
      const list = satellitesByParent.get(parentAddr) ?? [];
      list.push(block);
      satellitesByParent.set(parentAddr, list);
    }

    for (const block of blocks) {
      const location = blockSourceLocation(
        file.path,
        block.startLine,
        block.endLine,
      );

      if (block.kind === "resource" || block.kind === "data") {
        const qa = q(block.address);
        if (satelliteChildAddresses.has(qa)) {
          continue;
        }

        const rt = block.resourceType ?? "unknown";
        if (isTerraformOmittedFromServiceGraphResourceType(rt)) {
          continue;
        }
        const hints = lookupTerraformResourceHints(rt, config);
        const rawRefs = extractTerraformReferences(block.bodyText, config).filter(
          (r) => r !== block.address && !omittedTerraformAddresses.has(q(r)),
        );
        const refs = new Set(
          rawRefs.map((r) => qualifyTerraformReference(r, instancePrefix)),
        );

        const mergedSats = satellitesByParent.get(qa) ?? [];
        const terraform_satellites = mergedSats.map((s) => ({
          terraform_address: q(s.address),
          resource_type: s.resourceType ?? "unknown",
          start_line: s.startLine,
          end_line: s.endLine,
        }));

        for (const sat of mergedSats) {
          for (const r of extractTerraformReferences(sat.bodyText, config)) {
            if (r !== block.address && !omittedTerraformAddresses.has(q(r))) {
              refs.add(qualifyTerraformReference(r, instancePrefix));
            }
          }
        }

        findings.push({
          pattern: "terraform_resource",
          name: qa,
          confidence: 0.9,
          location,
          properties: {
            terraform_address: qa,
            terraform_block_kind: block.kind,
            resource_type: rt,
            block_name: block.blockName,
            componentSubType: hints.componentSubType,
            cloud_provider: hints.cloud_provider,
            section_id: sectionId,
            section_label: sectionLabel,
            terraform_references: Array.from(refs).sort((a, b) => a.localeCompare(b)),
            ...(instancePrefix
              ? { terraform_module_instance: instancePrefix }
              : {}),
            ...(terraform_satellites.length > 0
              ? { terraform_satellites }
              : {}),
          },
        });
        continue;
      }

      if (!emitModuleAndProvider) {
        continue;
      }

      if (block.kind === "module") {
        findings.push({
          pattern: "terraform_module",
          name: `module:${block.blockName}`,
          confidence: 0.88,
          location,
          properties: {
            terraform_address: block.address,
            module_name: block.blockName,
            componentSubType: "application",
            section_id: sectionId,
            section_label: sectionLabel,
          },
        });
        continue;
      }

      if (block.kind === "provider") {
        const pn = block.blockName;
        findings.push({
          pattern: "terraform_provider",
          name: `provider:${pn}`,
          confidence: 0.92,
          location,
          properties: {
            terraform_address: block.address,
            provider_name: pn,
            serviceName: lookupTerraformProviderServiceName(pn, config),
            section_id: sectionId,
            section_label: sectionLabel,
          },
        });
      }
    }
  }

  return findings;
}
