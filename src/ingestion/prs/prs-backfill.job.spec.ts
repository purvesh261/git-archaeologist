import type { Queue } from 'bullmq';
import type { GithubClient } from '../../github/github.client.js';
import type { ReposService } from '../../repos/repos.service.js';
import type { BackfillStore, RawItem } from '../backfill.store.js';
import { PagedBackfillRunner } from '../paged-backfill.runner.js';
import { PrsBackfillJob } from './prs-backfill.job.js';
import type { PrNode, PrsPageResponse } from './prs.queries.js';

const node = (number: number, overflow = false): PrNode => ({
  number,
  comments: {
    totalCount: 0,
    pageInfo: { hasNextPage: overflow, endCursor: null },
    nodes: [],
  },
});

const response = (nodes: PrNode[], endCursor: string, hasNextPage: boolean): PrsPageResponse => ({
  rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-10-15T18:00:00Z' },
  repository: {
    pullRequests: { totalCount: 3, pageInfo: { hasNextPage, endCursor }, nodes },
  },
});

function setup() {
  const graphql = vi
    .fn()
    .mockResolvedValueOnce(response([node(3), node(2, true)], 'p1', true))
    .mockResolvedValueOnce(response([node(1, true)], 'p2', false));
  const store = {
    getCursor: vi.fn(async () => null),
    savePage: vi.fn(
      async (_repoId: number, _job: string, _items: RawItem[], _next: unknown) => {},
    ),
  };
  const queue = { addBulk: vi.fn(async () => []) };
  const repos = { get: vi.fn(async () => ({ id: 7, owner: 'acme', name: 'widgets' })) };
  const job = new PrsBackfillJob(
    new PagedBackfillRunner(
      { graphql } as unknown as GithubClient,
      repos as unknown as ReposService,
      store as unknown as BackfillStore,
      queue as unknown as Queue,
    ),
  );
  return { job, graphql, store, queue };
}

describe('PrsBackfillJob', () => {
  it("pages PRs into sync_cursors job 'prs-backfill'", async () => {
    const t = setup();

    await expect(t.job.run({ repoId: 7 })).resolves.toEqual({
      pages: 2,
      prs: 3,
      overflow: 2,
    });
    expect(t.store.getCursor).toHaveBeenCalledWith(7, 'prs-backfill');
    const saves = t.store.savePage.mock.calls.map(([, job, items, next]) => [
      job,
      items.map((i) => i.kind),
      next,
    ]);
    expect(saves).toEqual([
      ['prs-backfill', ['pr', 'pr'], { cursor: 'p1', done: false }],
      ['prs-backfill', ['pr'], { cursor: 'p2', done: true }],
    ]);
    expect(t.graphql.mock.calls[1][0]).toContain('pullRequests(');
  });

  it('enqueues pr-thread jobs for overflow PRs with jobId pr-thread-<repoId>-<n>', async () => {
    const t = setup();

    await t.job.run({ repoId: 7 });

    expect(t.queue.addBulk.mock.calls.flat(2)).toEqual([
      {
        name: 'pr-thread',
        data: { repoId: 7, prNumber: 2 },
        opts: { jobId: 'pr-thread-7-2', removeOnComplete: true },
      },
      {
        name: 'pr-thread',
        data: { repoId: 7, prNumber: 1 },
        opts: { jobId: 'pr-thread-7-1', removeOnComplete: true },
      },
    ]);
  });
});
