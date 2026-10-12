import type { Queue } from 'bullmq';
import {
  GithubGraphqlError,
  type GithubClient,
} from '../../github/github.client.js';
import type { ReposService } from '../../repos/repos.service.js';
import type {
  BackfillStore,
  CursorState,
  RawItem,
} from '../backfill.store.js';
import { IssuesBackfillJob } from './issues-backfill.job.js';
import type { IssueNode, IssuesPageResponse } from './issues.queries.js';

const REPO_ID = 7;

const node = (number: number, overflow = false): IssueNode => ({
  number,
  comments: {
    totalCount: 0,
    pageInfo: { hasNextPage: overflow, endCursor: null },
    nodes: [],
  },
  timelineItems: {
    totalCount: 0,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [],
  },
});

const response = (
  nodes: IssueNode[],
  endCursor: string | null,
  hasNextPage: boolean,
  totalCount = 8,
): IssuesPageResponse => ({
  rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-10-12T18:00:00Z' },
  repository: {
    issues: { totalCount, pageInfo: { hasNextPage, endCursor }, nodes },
  },
});

/** 4 pages of 2 issues, newest first: page i has cursor `p<i>`. */
const PAGES = [1, 2, 3, 4].map((i) =>
  response([node(10 - 2 * i), node(9 - 2 * i)], `p${i}`, i < 4),
);
const pageAfter = (after: string | null) =>
  PAGES[after === null ? 0 : Number(after.slice(1))];

function setup(opts: { initial?: CursorState | null } = {}) {
  const events: string[] = [];
  const saved: string[] = [];
  let state: CursorState | null = opts.initial ?? null;

  const store = {
    getCursor: vi.fn(async () => state),
    savePage: vi.fn(
      async (
        _repoId: number,
        _job: string,
        items: RawItem[],
        next: { cursor: string | null; done: boolean },
      ) => {
        events.push('save');
        saved.push(...items.map((i) => i.externalId));
        state = {
          cursor: next.cursor,
          startedAt: state?.startedAt ?? new Date(),
          completedAt: next.done ? new Date() : null,
        };
      },
    ),
  };
  const graphql = vi.fn(
    async (_q: string, vars: { after: string | null }) => pageAfter(vars.after),
  );
  const queue = {
    addBulk: vi.fn(async () => {
      events.push('enqueue');
      return [];
    }),
  };
  const repos = { get: vi.fn(async () => ({ id: REPO_ID, owner: 'acme', name: 'widgets' })) };

  const job = new IssuesBackfillJob(
    { graphql } as unknown as GithubClient,
    repos as unknown as ReposService,
    store as unknown as BackfillStore,
    queue as unknown as Queue,
  );
  return { job, graphql, store, queue, events, saved, state: () => state };
}

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

describe('IssuesBackfillJob', () => {
  it('pages until hasNext is false and marks done', async () => {
    const t = setup();

    await expect(t.job.run({ repoId: REPO_ID })).resolves.toEqual({
      pages: 4,
      issues: 8,
      overflow: 0,
    });
    expect(t.graphql.mock.calls.map((c) => c[1].after)).toEqual([
      null,
      'p1',
      'p2',
      'p3',
    ]);
    expect(t.graphql.mock.calls[0][1]).toMatchObject({
      owner: 'acme',
      name: 'widgets',
      first: 50,
      inner: 50,
    });
    expect(t.state()?.completedAt).toBeInstanceOf(Date);
  });

  it('resumes from the last committed cursor after a crash', async () => {
    const t = setup();
    t.graphql.mockImplementationOnce(async () => PAGES[0]);
    t.graphql.mockImplementationOnce(async () => PAGES[1]);
    t.graphql.mockImplementationOnce(async () => {
      throw new Error('worker died');
    });

    await expect(t.job.run({ repoId: REPO_ID })).rejects.toThrow('worker died');
    expect(t.state()?.cursor).toBe('p2');
    t.graphql.mockClear();

    await t.job.run({ repoId: REPO_ID });

    expect(t.graphql.mock.calls[0][1].after).toBe('p2');
    expect(t.saved).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
  });

  it('halves page size on timeout and retries the same cursor', async () => {
    const t = setup({
      initial: { cursor: 'p1', startedAt: new Date(), completedAt: null },
    });
    t.graphql.mockRejectedValueOnce(httpError(502));

    await t.job.run({ repoId: REPO_ID });

    const [first, second] = t.graphql.mock.calls.map((c) => c[1]);
    expect(first).toMatchObject({ first: 50, after: 'p1' });
    expect(second).toMatchObject({ first: 25, inner: 25, after: 'p1' });
    // stays reduced for the rest of the run
    expect(t.graphql.mock.calls.at(-1)?.[1].first).toBe(25);
  });

  it('treats a GraphQL timeout error inside a 200 response as a timeout', async () => {
    const t = setup();
    t.graphql.mockRejectedValueOnce(
      new GithubGraphqlError([
        {
          message:
            'Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.',
        },
      ]),
    );

    await t.job.run({ repoId: REPO_ID });

    expect(t.graphql.mock.calls[1][1]).toMatchObject({ first: 25, after: null });
  });

  it('rethrows when page size would drop below the floor', async () => {
    const t = setup();
    t.graphql.mockRejectedValue(httpError(504));

    await expect(t.job.run({ repoId: REPO_ID, pageSize: 5 })).rejects.toThrow(
      'HTTP 504',
    );
    expect(t.graphql).toHaveBeenCalledTimes(1);
  });

  it('does not treat other HTTP errors as timeouts', async () => {
    const t = setup();
    t.graphql.mockRejectedValue(httpError(500));

    await expect(t.job.run({ repoId: REPO_ID })).rejects.toThrow('HTTP 500');
    expect(t.graphql).toHaveBeenCalledTimes(1);
  });

  it('marks an empty repo complete', async () => {
    const t = setup();
    t.graphql.mockResolvedValue(response([], null, false, 0));

    await expect(t.job.run({ repoId: REPO_ID })).resolves.toEqual({
      pages: 1,
      issues: 0,
      overflow: 0,
    });
    expect(t.graphql).toHaveBeenCalledTimes(1);
    expect(t.state()?.completedAt).toBeInstanceOf(Date);
  });

  it('keeps the last cursor when the final page is empty', async () => {
    const t = setup({
      initial: { cursor: 'p4', startedAt: new Date(), completedAt: null },
    });
    t.graphql.mockResolvedValue(response([], null, false));

    await t.job.run({ repoId: REPO_ID });

    expect(t.state()).toMatchObject({ cursor: 'p4' });
    expect(t.state()?.completedAt).toBeInstanceOf(Date);
  });

  it('skips a completed backfill', async () => {
    const t = setup({
      initial: { cursor: 'p4', startedAt: new Date(), completedAt: new Date() },
    });

    await expect(t.job.run({ repoId: REPO_ID })).resolves.toEqual({
      pages: 0,
      issues: 0,
      overflow: 0,
    });
    expect(t.graphql).not.toHaveBeenCalled();
  });

  it('enqueues one issue-thread job per overflow issue with a deterministic jobId, before the page is saved', async () => {
    const t = setup();
    t.graphql.mockResolvedValue(
      response([node(3, true), node(2), node(1, true)], 'p1', false),
    );

    await expect(t.job.run({ repoId: REPO_ID })).resolves.toMatchObject({
      overflow: 2,
    });
    // enqueue first: a crash between the two then re-enqueues (deduped) instead of losing threads
    expect(t.events).toEqual(['enqueue', 'save']);
    expect(t.queue.addBulk).toHaveBeenCalledWith([
      {
        name: 'issue-thread',
        data: { repoId: REPO_ID, issueNumber: 3 },
        opts: { jobId: `issue-thread-${REPO_ID}-3`, removeOnComplete: true },
      },
      {
        name: 'issue-thread',
        data: { repoId: REPO_ID, issueNumber: 1 },
        opts: { jobId: `issue-thread-${REPO_ID}-1`, removeOnComplete: true },
      },
    ]);
  });

  it('reports progress to the BullMQ job', async () => {
    const t = setup();
    const updateProgress = vi.fn();

    await t.job.run({ repoId: REPO_ID }, { updateProgress } as never);

    expect(updateProgress).toHaveBeenCalledTimes(4);
    expect(updateProgress).toHaveBeenLastCalledWith({
      pages: 4,
      issues: 8,
      totalCount: 8,
    });
  });
});
