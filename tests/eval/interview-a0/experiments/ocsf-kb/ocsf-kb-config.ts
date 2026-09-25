export const DEFAULT_OCSF_KB_DIR =
  "/Users/home/Projects/knowledge-base/project/wiki/graph/dogfood/ocsf-discoveries";

export function resolveOcsfKbDir(): string {
  return process.env.OCSF_KB_DIR ?? DEFAULT_OCSF_KB_DIR;
}
