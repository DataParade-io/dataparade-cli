import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectGitContext,
  gitContextFromRemote,
  parseGitRemote,
} from '../../../src/output/git-context';

const SHA = 'a'.repeat(40);

describe('parseGitRemote', () => {
  it.each([
    ['git@github.com:org/repo.git', 'github.com', 'org/repo'],
    ['https://github.com/org/repo', 'github.com', 'org/repo'],
    ['https://github.com/org/repo.git/', 'github.com', 'org/repo'],
    ['ssh://git@github.com:22/org/repo.git', 'github.com', 'org/repo'],
    ['https://user:pw@GitLab.com/group/sub/repo.git', 'gitlab.com', 'group/sub/repo'],
  ])('parses %s', (remote, host, repository) => {
    expect(parseGitRemote(remote)).toMatchObject({ host, repository });
  });

  it.each(['', 'not a url', '/local/path/repo', 'file:///tmp/repo', 'https://github.com/repo'])(
    'rejects %s',
    (remote) => {
      expect(parseGitRemote(remote)).toBeNull();
    }
  );
});

describe('gitContextFromRemote', () => {
  it('maps GitHub and gitlab.com without a base URL', () => {
    expect(gitContextFromRemote('git@github.com:org/repo.git', SHA)).toEqual({
      provider: 'github',
      repository: 'org/repo',
      commitSha: SHA,
    });
    expect(gitContextFromRemote('https://gitlab.com/g/r.git', SHA)).toEqual({
      provider: 'gitlab',
      repository: 'g/r',
      commitSha: SHA,
    });
  });

  it('keeps the base URL for self-hosted GitLab', () => {
    expect(
      gitContextFromRemote('git@gitlab.acme.io:team/app.git', SHA)
    ).toEqual({
      provider: 'gitlab',
      repository: 'team/app',
      commitSha: SHA,
      baseUrl: 'https://gitlab.acme.io',
    });
  });

  it('returns null for other hosts and bad SHAs', () => {
    expect(gitContextFromRemote('git@bitbucket.org:org/repo.git', SHA)).toBeNull();
    expect(gitContextFromRemote('git@github.com:org/repo.git', 'abc')).toBeNull();
  });
});

describe('detectGitContext', () => {
  let dir: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dp-git-context-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null outside a repository', () => {
    expect(detectGitContext(dir)).toBeNull();
  });

  it('returns null for a repository without an origin', () => {
    git('init', '-q');
    expect(detectGitContext(dir)).toBeNull();
  });

  it('reads origin and HEAD', () => {
    git('init', '-q');
    git('remote', 'add', 'origin', 'git@github.com:org/repo.git');
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init'
    );
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();

    expect(detectGitContext(dir)).toEqual({
      provider: 'github',
      repository: 'org/repo',
      commitSha: head,
    });
  });
});
