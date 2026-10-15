import { readFileSync } from 'node:fs';
import { parsePrsPage } from './prs.parse.js';
import type { PrsPageResponse } from './prs.queries.js';

const fixture = (): PrsPageResponse =>
  JSON.parse(
    readFileSync(new URL('./__fixtures__/prs-page.json', import.meta.url), 'utf8'),
  ) as PrsPageResponse;

const empty = (): PrsPageResponse => ({
  rateLimit: { cost: 1, remaining: 4999, resetAt: '2026-10-15T18:00:00Z' },
  repository: {
    pullRequests: {
      totalCount: 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [],
    },
  },
});

describe('parsePrsPage', () => {
  it("maps each PR node to a RawItem with kind 'pr' and externalId = number", () => {
    const data = fixture();
    const page = parsePrsPage(data);

    expect(page.items.map((i) => [i.kind, i.externalId])).toEqual([
      ['pr', '203'],
      ['pr', '202'],
      ['pr', '201'],
    ]);
    // payload is the node exactly as fetched
    expect(page.items[0].payload).toBe(data.repository!.pullRequests.nodes[0]);
    expect(page.next).toEqual({ cursor: 'Y3Vyc29yOjM=', hasNext: true });
    expect(page.totalCount).toBe(240);
    expect(page.rateLimit).toEqual({
      cost: 2,
      remaining: 4980,
      resetAt: '2026-10-15T18:00:00Z',
    });
  });

  it('flags PRs with more comments than the page as overflow', () => {
    expect(parsePrsPage(fixture()).overflow).toEqual([202]);
  });

  it('tolerates deleted authors and a null mergeCommit', () => {
    const page = parsePrsPage(fixture());
    expect(page.items.find((i) => i.externalId === '202')?.payload).toMatchObject({
      author: null,
      mergeCommit: null,
    });
  });

  it('returns hasNext false and no items for an empty page', () => {
    const page = parsePrsPage(empty());
    expect(page.items).toEqual([]);
    expect(page.overflow).toEqual([]);
    expect(page.next).toEqual({ cursor: null, hasNext: false });
    expect(page.totalCount).toBe(0);
  });

  it('throws on a null repository', () => {
    expect(() => parsePrsPage({ ...empty(), repository: null })).toThrow(/repository/i);
  });
});
