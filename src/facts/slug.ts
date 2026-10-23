import { createHash } from "crypto";

/** Longest slug before the `.json` suffix; far below filesystem limits. */
const MAX_SLUG = 80;

function baseSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/[-.]+$/g, "");
  return slug || "item";
}

function shortHash(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 6);
}

/**
 * File-safe, stable slugs for data item names. A name keeps its plain slug unless
 * another name shares it; then every name in the clash gets a short hash of its own
 * name, so the result does not depend on the order of the list.
 */
export function dataItemSlugs(names: string[]): Map<string, string> {
  const byBase = new Map<string, string[]>();
  for (const name of names) {
    const base = baseSlug(name);
    const list = byBase.get(base) ?? [];
    if (!list.includes(name)) list.push(name);
    byBase.set(base, list);
  }
  const slugs = new Map<string, string>();
  for (const [base, list] of byBase) {
    for (const name of list) {
      slugs.set(name, list.length === 1 ? base : `${base}-${shortHash(name)}`);
    }
  }
  return slugs;
}

export function dataItemFilePath(slug: string): string {
  return `data-items/${slug}.json`;
}
