import type { GithubClient } from '../../github/github.client.js';
import type { ReposService } from '../../repos/repos.service.js';
import type { BackfillStore } from '../backfill.store.js';
import { IssueThreadJob } from './issue-thread.job.js';
import type { IssueThreadResponse } from './issues.queries.js';

const conn = (nodes: string[], endCursor: string, hasNextPage: boolean) => ({
  pageInfo: { hasNextPage, endCursor },
  nodes,
});

interface Vars {
  number: number;
  commentsAfter: string | null;
  timelineAfter: string | null;
  withComments: boolean;
  withTimeline: boolean;
}

function setup() {
  // Comments span 3 pages, the timeline fits in 1.
  const comments = [
    conn(['c1', 'c2'], 'C1', true),
    conn(['c3', 'c4'], 'C2', true),
    conn(['c5'], 'C3', false),
  ];
  const graphql = vi.fn(
    async (_q: string, v: Vars): Promise<IssueThreadResponse> => ({
      repository: {
        issue: {
          ...(v.withComments && {
            comments: comments[v.commentsAfter ? Number(v.commentsAfter[1]) : 0],
          }),
          ...(v.withTimeline && {
            timelineItems: conn(['t1', 't2'], 'T1', false),
          }),
        },
      },
    }),
  );
  const store = { saveItems: vi.fn(async () => {}) };
  const repos = {
    get: vi.fn(async () => ({ id: 7, owner: 'acme', name: 'widgets' })),
  };
  const job = new IssueThreadJob(
    { graphql } as unknown as GithubClient,
    repos as unknown as ReposService,
    store as unknown as BackfillStore,
  );
  return { job, graphql, store };
}

describe('IssueThreadJob', () => {
  it('paginates comments and timeline independently until both are exhausted', async () => {
    const t = setup();

    await expect(t.job.run({ repoId: 7, issueNumber: 42 })).resolves.toEqual({
      comments: 5,
      timelineItems: 2,
    });

    const vars = t.graphql.mock.calls.map((c) => c[1]);
    expect(vars).toHaveLength(3);
    expect(vars.map((v) => [v.commentsAfter, v.withComments])).toEqual([
      [null, true],
      ['C1', true],
      ['C2', true],
    ]);
    // the timeline is requested once, then dropped instead of re-requested
    expect(vars.map((v) => v.withTimeline)).toEqual([true, false, false]);
    expect(vars[0]).toMatchObject({ owner: 'acme', name: 'widgets', number: 42 });
  });

  it('stores the concatenated nodes as one issue_thread row', async () => {
    const t = setup();

    await t.job.run({ repoId: 7, issueNumber: 42 });

    expect(t.store.saveItems).toHaveBeenCalledTimes(1);
    expect(t.store.saveItems).toHaveBeenCalledWith(7, [
      {
        kind: 'issue_thread',
        externalId: '42',
        payload: {
          comments: ['c1', 'c2', 'c3', 'c4', 'c5'],
          timelineItems: ['t1', 't2'],
          fetchedPages: 3,
        },
      },
    ]);
  });

  it('is idempotent', async () => {
    // Re-runs re-fetch from the start and write the same (kind, externalId);
    // the store's upsert (backfill.store.int.spec) keeps that to one row.
    const t = setup();

    await t.job.run({ repoId: 7, issueNumber: 42 });
    await t.job.run({ repoId: 7, issueNumber: 42 });

    const [first, second] = t.store.saveItems.mock.calls as unknown[][];
    expect(second).toEqual(first);
    expect(t.graphql.mock.calls[3][1].commentsAfter).toBeNull();
  });

  it('throws when the issue no longer exists', async () => {
    const t = setup();
    t.graphql.mockResolvedValueOnce({ repository: { issue: null } });

    await expect(t.job.run({ repoId: 7, issueNumber: 42 })).rejects.toThrow(
      /#42/,
    );
    expect(t.store.saveItems).not.toHaveBeenCalled();
  });
});
