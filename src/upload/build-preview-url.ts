import { getDataparadeAppBaseUrl } from "../platform-api/dataparade-app-base-url";

export function buildImportPreviewUrl(
  draftId: string,
  cliSessionId?: string,
): string {
  const base = getDataparadeAppBaseUrl();
  const url = new URL("/dashboard", `${base}/`);
  url.searchParams.set("importDraft", draftId);
  if (cliSessionId?.trim()) {
    url.searchParams.set("cliSession", cliSessionId.trim());
  }
  return url.toString();
}

export function buildAnonymousCliPreviewUrl(
  claimToken: string,
  cliSessionId?: string,
): string {
  const base = getDataparadeAppBaseUrl();
  const encoded = encodeURIComponent(claimToken);
  const url = new URL(`/preview/cli/${encoded}`, `${base}/`);
  if (cliSessionId?.trim()) {
    url.searchParams.set("cliSession", cliSessionId.trim());
  }
  return url.toString();
}
