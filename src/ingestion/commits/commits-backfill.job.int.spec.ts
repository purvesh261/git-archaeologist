import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { GitService } from '../../git/git.service.js';
import { ReposService, type Repo } from '../../repos/repos.service.js';
import { BackfillStore, type CursorState } from '../backfill.store.js';
import { CommitsBackfillJob } from './commits-backfill.job.js';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('CommitsBackfillJob (integration)', () => {
  const db = new DatabaseService({ get: () => url } as unknown as ConfigService<Env, true>);
  const store = new BackfillStore(db);
  let root: string;
  let source: string;
  let repoId: number;
  let job: CommitsBackfillJob;
  let cursorsDuringSaves: (CursorState | null)[];

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: source,
      env: { ...process.env, GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x' },
      encoding: 'utf8',
    }).trim();
  const commits = (n: number) => {
    for (let i = 0; i < n; i++) git('commit', '-q', '--allow-empty', '-m', `c${i}`);
    return git('rev-parse', 'HEAD');
  };
  const rowCount = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*) as n from raw_items where repo_id = $1 and kind = 'commit'",
          [repoId],
        )
      ).rows[0].n,
    );

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'ga-commits-'));
    source = join(root, 'source');
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    const { rows } = await db.query<{ id: number }>(
      'insert into repos (owner, name) values ($1, $2) returning id',
      ['acme', `widgets-${process.pid}-${Date.now()}`],
    );
    repoId = rows[0].id;

    const real = new GitService({ get: () => join(root, 'data') } as unknown as ConfigService<Env, true>);
    // Point the clone at the local source repo instead of github.com.
    const gitSvc = Object.assign(Object.create(real) as GitService, {
      ensureClone: (repo: Repo) => real.ensureClone(repo, `file://${source}`),
    });
    cursorsDuringSaves = [];
    const spyStore = Object.assign(Object.create(store) as BackfillStore, {
      saveItems: async (...args: Parameters<BackfillStore['saveItems']>) => {
        await store.saveItems(...args);
        cursorsDuringSaves.push(await store.getCursor(repoId, 'commits-backfill'));
      },
    });
    job = new CommitsBackfillJob(gitSvc, new ReposService(db), spyStore);
  });

  afterEach(async () => {
    await db.query('delete from repos where id = $1', [repoId]);
    rmSync(root, { recursive: true, force: true });
  });

  afterAll(() => db.onModuleDestroy());

  it('stores every commit when there are more than one batch', async () => {
    const head = commits(5);

    await expect(job.run({ repoId, batchSize: 2 })).resolves.toEqual({ commits: 5, head });
    expect(await rowCount()).toBe(5);
  });

  it('records HEAD sha and completed_at only after the last batch', async () => {
    const head = commits(5);

    await job.run({ repoId, batchSize: 2 });

    // two full batches go through saveItems before the last one commits the cursor
    expect(cursorsDuringSaves).toEqual([null, null]);
    expect(await store.getCursor(repoId, 'commits-backfill')).toMatchObject({
      cursor: head,
      completedAt: expect.any(Date),
    });
  });

  it('a rerun after a new commit adds one row and moves the cursor', async () => {
    commits(3);
    await job.run({ repoId, batchSize: 2 });
    const head = commits(1);

    await expect(job.run({ repoId, batchSize: 2 })).resolves.toEqual({ commits: 4, head });

    expect(await rowCount()).toBe(4);
    expect((await store.getCursor(repoId, 'commits-backfill'))?.cursor).toBe(head);
  });
});
