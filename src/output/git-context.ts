import { execFileSync } from 'node:child_process';
import {
  gitContextSchema,
  type GitContextSchema,
} from '../core/schema/dataflow-wrapper.schema';

const GIT_TIMEOUT_MS = 5000;

type ParsedRemote = { host: string; repository: string; protocol: string };

/** Accepts `git@host:owner/repo.git`, `ssh://git@host[:port]/owner/repo` and http(s) remotes. */
export function parseGitRemote(remote: string): ParsedRemote | null {
  const trimmed = remote.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  let host: string;
  let path: string;
  let protocol = 'https:';
  if (scp && !trimmed.includes('://')) {
    host = scp[1];
    path = scp[2];
  } else {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) {
      return null;
    }
    host = url.hostname;
    path = url.pathname;
    if (url.protocol === 'http:') protocol = 'http:';
  }
  const repository = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  if (!host || !repository.includes('/')) return null;
  return { host: host.toLowerCase(), repository, protocol };
}

/** Maps a remote to the dataflow git context; null for hosts other than GitHub and GitLab. */
export function gitContextFromRemote(
  remote: string,
  commitSha: string
): GitContextSchema | null {
  const parsed = parseGitRemote(remote);
  if (!parsed) return null;
  let candidate: GitContextSchema;
  if (parsed.host === 'github.com') {
    candidate = {
      provider: 'github',
      repository: parsed.repository,
      commitSha,
    };
  } else if (parsed.host === 'gitlab.com') {
    candidate = {
      provider: 'gitlab',
      repository: parsed.repository,
      commitSha,
    };
  } else if (parsed.host.includes('gitlab')) {
    candidate = {
      provider: 'gitlab',
      repository: parsed.repository,
      commitSha,
      baseUrl: `${parsed.protocol}//${parsed.host}`,
    };
  } else {
    return null;
  }
  const validated = gitContextSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Reads the origin remote and HEAD of the repository containing `dir`, so
 * uploads can be matched to their repository. Never throws: no git, no repo
 * or no origin all return null.
 */
export function detectGitContext(dir: string): GitContextSchema | null {
  const remote = git(dir, ['remote', 'get-url', 'origin']);
  if (!remote) return null;
  const commitSha = git(dir, ['rev-parse', 'HEAD']);
  if (!commitSha) return null;
  return gitContextFromRemote(remote, commitSha);
}
