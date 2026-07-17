import { getDataparadeAppBaseUrl } from "../platform-api/dataparade-app-base-url";

export function buildImportPreviewUrl(draftId: string): string {
  const base = getDataparadeAppBaseUrl();
  const url = new URL("/dashboard", `${base}/`);
  url.searchParams.set("importDraft", draftId);
  return url.toString();
}

export function buildAnonymousCliPreviewUrl(claimToken: string): string {
  const base = getDataparadeAppBaseUrl();
  const encoded = encodeURIComponent(claimToken);
  return `${base}/preview/cli/${encoded}`;
}
