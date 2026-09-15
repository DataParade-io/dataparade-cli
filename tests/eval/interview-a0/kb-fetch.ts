export interface GitHubFileContent {
  content: string;
  blobSha: string;
}

/**
 * Cross-repo reads require GH_TOKEN (PAT or app token with contents:read on
 * DataParade-io/knowledge-base). In GitHub Actions, the default GITHUB_TOKEN
 * cannot read other private repos and must not be used as a fallback here.
 */
function resolveAuthToken(): string | undefined {
  return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = resolveAuthToken();
  if (process.env.CI === "true" && !process.env.GH_TOKEN) {
    throw new Error(
      "Missing repository secret GH_TOKEN. Interview-a0 eval requires a live fetch from " +
        "DataParade-io/knowledge-base at pinned SHAs; there is no vendored brief fallback. " +
        "Add GH_TOKEN (contents:read on DataParade-io/knowledge-base) to this repo's Actions secrets.",
    );
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchGitHubFile(
  repository: string,
  filePath: string,
  ref: string,
): Promise<GitHubFileContent> {
  const url = `https://api.github.com/repos/${repository}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Failed to fetch ${repository}/${filePath}@${ref}: HTTP ${response.status}. ` +
        `Ensure GH_TOKEN (preferred) can read the private knowledge-base repo. ${detail}`,
    );
  }

  const payload = (await response.json()) as {
    content?: string;
    sha?: string;
    encoding?: string;
  };

  if (!payload.content || payload.encoding !== "base64" || !payload.sha) {
    throw new Error(`Unexpected GitHub contents payload for ${filePath}`);
  }

  return {
    content: Buffer.from(payload.content, "base64").toString("utf8"),
    blobSha: payload.sha,
  };
}

export async function verifyCommitRef(repository: string, commit: string): Promise<void> {
  const url = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(commit)}`;
  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    throw new Error(
      `Pinned commit ${commit} not found on ${repository}: HTTP ${response.status}. ` +
        "Manifest pin may have drifted.",
    );
  }
}
