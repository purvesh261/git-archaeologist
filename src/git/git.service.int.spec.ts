import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { GitService } from './git.service.js';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'A',
  GIT_AUTHOR_EMAIL: 'a@example.com',
  GIT_COMMITTER_NAME: 'A',
  GIT_COMMITTER_EMAIL: 'a@example.com',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

const repo = { id: 7, owner: 'acme', name: 'widgets' };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ga-git-'));
  const source = join(root, 'source');
  const dataDir = join(root, 'data');
  mkdirSync(source);
  git(source, 'init', '-q', '-b', 'main');
  git(source, 'commit', '-q', '--allow-empty', '-m', 'first');
  const config = { get: () => dataDir } as unknown as ConfigService<Env, true>;
  return {
    root,
    source,
    dataDir,
    url: `file://${source}`,
    svc: new GitService(config),
    head: (gitDir: string) => git(root, '--git-dir', gitDir, 'rev-parse', 'HEAD'),
  };
}

describe('GitService', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });
  afterEach(() => rmSync(t.root, { recursive: true, force: true }));

  it('clones a repo bare into <dir>/<repoId>.git', async () => {
    const path = await t.svc.ensureClone(repo, t.url);

    expect(path).toBe(join(t.dataDir, '7.git'));
    expect(git(t.root, '--git-dir', path, 'rev-parse', '--is-bare-repository')).toBe('true');
    expect(t.head(path)).toBe(git(t.source, 'rev-parse', 'HEAD'));
  });

  it('fetches into an existing clone', async () => {
    const path = await t.svc.ensureClone(repo, t.url);
    // a re-clone would replace the directory and lose this file
    writeFileSync(join(path, 'marker'), '');
    git(t.source, 'commit', '-q', '--allow-empty', '-m', 'second');

    await t.svc.ensureClone(repo, t.url);

    expect(t.head(path)).toBe(git(t.source, 'rev-parse', 'HEAD'));
    expect(existsSync(join(path, 'marker'))).toBe(true);
  });

  it('replaces a leftover partial clone', async () => {
    const tmp = join(t.dataDir, '7.git.tmp');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'junk'), '');

    const path = await t.svc.ensureClone(repo, t.url);

    expect(existsSync(tmp)).toBe(false);
    expect(t.head(path)).toBe(git(t.source, 'rev-parse', 'HEAD'));
  });

  it('rejects owner/name with path or shell characters', async () => {
    for (const bad of [
      { owner: '../x', name: 'widgets' },
      { owner: 'acme', name: 'a;b' },
      { owner: 'acme', name: '..' },
    ]) {
      await expect(t.svc.ensureClone({ ...repo, ...bad })).rejects.toThrow(/invalid/i);
    }
    expect(existsSync(t.dataDir)).toBe(false);
  });

  it('fails fast without prompting when the url needs auth', async () => {
    await expect(
      t.svc.ensureClone(repo, `file://${join(t.root, 'missing.git')}`),
    ).rejects.toThrow();
    expect(existsSync(join(t.dataDir, '7.git'))).toBe(false);
  });

  it('spawnLog streams stdout and errors when git fails', async () => {
    const path = await t.svc.ensureClone(repo, t.url);

    await expect(text(t.svc.spawnLog(path, ['log', '--format=%s']))).resolves.toBe('first\n');
    await expect(text(t.svc.spawnLog(path, ['log', 'no-such-ref']))).rejects.toThrow(
      /no-such-ref/,
    );
  });
});
