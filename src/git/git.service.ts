import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { Repo } from '../repos/repos.service.js';

const execFileAsync = promisify(execFile);

// Ignore the host's git config (credential helpers, output encoding, signatures) so
// output is the same on every machine; auth failures fail instead of prompting.
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
// Abort a transfer that stalls below 1 KB/s for a minute instead of hanging the worker.
const NET_ARGS = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=60'];
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

/** Bare clones per repo, kept on disk so later git tools run locally. Git runs without a shell. */
@Injectable()
export class GitService {
  private readonly logger = new Logger(GitService.name);
  private readonly dataDir: string;

  constructor(config: ConfigService<Env, true>) {
    this.dataDir = resolve(config.get('GIT_DATA_DIR', { infer: true }));
  }

  /** Clones the repo bare on first use, fetches on later runs; returns the git dir. */
  async ensureClone(
    repo: Repo,
    url = `https://github.com/${repo.owner}/${repo.name}.git`,
  ): Promise<string> {
    for (const part of [repo.owner, repo.name]) {
      if (!SAFE_NAME.test(part) || /^\.+$/.test(part)) {
        throw new Error(`Invalid repo name part: ${JSON.stringify(part)}`);
      }
    }
    const path = join(this.dataDir, `${repo.id}.git`);

    if (existsSync(path)) {
      await this.run(path, [...NET_ARGS, 'fetch', '--prune', '--no-tags', url, '+refs/heads/*:refs/heads/*']);
      // Follow a default-branch rename, or HEAD points at a pruned branch.
      const remoteHead = await this.run(path, [...NET_ARGS, 'ls-remote', '--symref', url, 'HEAD']);
      const ref = /^ref: (refs\/heads\/\S+)\tHEAD$/m.exec(remoteHead)?.[1];
      if (ref) await this.run(path, ['symbolic-ref', 'HEAD', ref]);
      return path;
    }

    // Clone beside the target and rename, so a crash never leaves a half clone at `path`.
    const tmp = `${path}.tmp`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(this.dataDir, { recursive: true });
    const started = Date.now();
    await execFileAsync('git', [...NET_ARGS, 'clone', '--bare', '--no-tags', url, tmp], {
      env: GIT_ENV,
    });
    await rename(tmp, path);
    this.logger.log(`cloned repo ${repo.id} in ${Math.round((Date.now() - started) / 1000)}s`);
    return path;
  }

  async run(gitDir: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['--git-dir', gitDir, ...args], {
      env: GIT_ENV,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  }

  /** Streams stdout; the stream errors if git exits non-zero. */
  spawnLog(gitDir: string, args: string[]): Readable {
    const child = spawn('git', ['--git-dir', gitDir, ...args], { env: GIT_ENV });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const exit = new Promise<number | null>((res, rej) => {
      child.on('error', rej);
      child.on('close', res);
    });
    // Awaited only after stdout ends; without this a spawn error is an unhandled rejection.
    exit.catch(() => {});
    return Readable.from(
      (async function* () {
        yield* child.stdout;
        const code = await exit;
        if (code !== 0) throw new Error(`git ${args[0]} exited ${code}: ${stderr.trim()}`);
      })(),
      { objectMode: false },
    );
  }
}
