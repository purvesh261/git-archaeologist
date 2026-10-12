import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { DatabaseService, type Queryable } from '../database/database.service.js';
import { BackfillStore, type RawItem } from './backfill.store.js';

const url = process.env.DATABASE_URL;
const JOB = 'issues-backfill';

describe.skipIf(!url)('BackfillStore (integration)', () => {
  const db = new DatabaseService({
    get: () => url,
  } as unknown as ConfigService<Env, true>);
  const store = new BackfillStore(db);
  let repoId: number;

  const issue = (n: number, title = `t${n}`): RawItem => ({
    kind: 'issue',
    externalId: String(n),
    payload: { number: n, title },
  });

  const rows = async () =>
    (
      await db.query<{ external_id: string; payload: { title: string } }>(
        'select external_id, payload from raw_items where repo_id = $1 order by external_id',
        [repoId],
      )
    ).rows;

  beforeEach(async () => {
    const { rows: r } = await db.query<{ id: number }>(
      'insert into repos (owner, name) values ($1, $2) returning id',
      ['acme', `widgets-${process.pid}-${Math.random()}`],
    );
    repoId = r[0].id;
  });

  afterEach(async () => {
    await db.query('delete from repos where id = $1', [repoId]);
  });

  afterAll(() => db.onModuleDestroy());

  it('saves items and advances the cursor together', async () => {
    expect(await store.getCursor(repoId, JOB)).toBeNull();

    await store.savePage(repoId, JOB, [issue(2), issue(1)], {
      cursor: 'c1',
      done: false,
    });

    expect((await rows()).map((r) => r.external_id)).toEqual(['1', '2']);
    const state = await store.getCursor(repoId, JOB);
    expect(state?.cursor).toBe('c1');
    expect(state?.startedAt).toBeInstanceOf(Date);
    expect(state?.completedAt).toBeNull();
  });

  it('is idempotent per (repo_id, kind, external_id)', async () => {
    await store.savePage(repoId, JOB, [issue(1, 'old'), issue(2)], {
      cursor: 'c1',
      done: false,
    });
    await store.savePage(repoId, JOB, [issue(1, 'new'), issue(2)], {
      cursor: 'c1',
      done: false,
    });

    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r[0].payload.title).toBe('new');
  });

  it('rolls back rows when the cursor write fails', async () => {
    await store.savePage(repoId, JOB, [issue(1)], { cursor: 'c1', done: false });

    // Same store, but the sync_cursors statement fails inside the transaction.
    const failing = new BackfillStore({
      transaction: (fn: (q: Queryable) => Promise<unknown>) =>
        db.transaction((q) =>
          fn({
            query: (text: string, params?: unknown[]) =>
              text.includes('sync_cursors')
                ? Promise.reject(new Error('cursor write failed'))
                : q.query(text, params),
          } as Queryable),
        ),
    } as unknown as DatabaseService);

    await expect(
      failing.savePage(repoId, JOB, [issue(2), issue(3)], {
        cursor: 'c2',
        done: false,
      }),
    ).rejects.toThrow('cursor write failed');

    expect((await rows()).map((r) => r.external_id)).toEqual(['1']);
    expect((await store.getCursor(repoId, JOB))?.cursor).toBe('c1');
  });

  it('sets completed_at only when done', async () => {
    await store.savePage(repoId, JOB, [issue(1)], { cursor: 'c1', done: false });
    const first = await store.getCursor(repoId, JOB);
    expect(first?.completedAt).toBeNull();

    await store.savePage(repoId, JOB, [], { cursor: 'c2', done: true });
    const last = await store.getCursor(repoId, JOB);
    expect(last?.completedAt).toBeInstanceOf(Date);
    // started_at is the first write's, not overwritten by later pages
    expect(last?.startedAt).toEqual(first?.startedAt);
  });

  it('reset clears cursor and timestamps', async () => {
    await store.savePage(repoId, JOB, [issue(1)], { cursor: 'c1', done: true });

    await store.reset(repoId, JOB);

    expect(await store.getCursor(repoId, JOB)).toBeNull();
    expect(await rows()).toHaveLength(1); // reset restarts paging; it keeps fetched data
  });

  it('replaces text Postgres jsonb rejects instead of failing the page', async () => {
    // \u0000 and lone surrogates are valid JS strings but invalid jsonb.
    await store.savePage(repoId, JOB, [issue(1, 'a\u0000b\ud800c')], {
      cursor: 'c1',
      done: false,
    });
    expect((await rows())[0].payload.title).toBe('a\ufffdb\ufffdc');
  });

  it('saveItems upserts without touching the cursor', async () => {
    await store.saveItems(repoId, [
      { kind: 'issue_thread', externalId: '7', payload: { comments: [] } },
    ]);
    expect(await rows()).toHaveLength(1);
    expect(await store.getCursor(repoId, JOB)).toBeNull();
  });
});
