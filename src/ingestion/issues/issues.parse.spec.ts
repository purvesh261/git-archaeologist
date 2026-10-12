import { readFileSync } from 'node:fs';
import { parseIssuesPage } from './issues.parse.js';
import type { IssuesPageResponse } from './issues.queries.js';

const fixture = (name: string): IssuesPageResponse =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'),
  ) as IssuesPageResponse;

describe('parseIssuesPage', () => {
  it("maps each issue node to a RawItem with kind 'issue' and externalId = number", () => {
    const data = fixture('issues-page');
    const page = parseIssuesPage(data);

    expect(page.items.map((i) => [i.kind, i.externalId])).toEqual([
      ['issue', '103'],
      ['issue', '102'],
      ['issue', '101'],
    ]);
    // payload is the node exactly as fetched
    expect(page.items[0].payload).toBe(data.repository!.issues.nodes[0]);
    expect(page.next).toEqual({ cursor: 'Y3Vyc29yOjM=', hasNext: true });
    expect(page.totalCount).toBe(120);
    expect(page.rateLimit).toEqual({
      cost: 2,
      remaining: 4990,
      resetAt: '2026-10-12T18:00:00Z',
    });
  });

  it('flags overflow threads', () => {
    // 102 overflows on comments, 101 on timeline; 103 fits
    expect(parseIssuesPage(fixture('issues-page')).overflow).toEqual([102, 101]);
  });

  it('tolerates deleted authors', () => {
    const page = parseIssuesPage(fixture('issues-page'));
    expect(page.items.find((i) => i.externalId === '102')).toBeDefined();
  });

  it('returns hasNext false and no items for an empty page', () => {
    const page = parseIssuesPage(fixture('empty-page'));
    expect(page.items).toEqual([]);
    expect(page.overflow).toEqual([]);
    expect(page.next).toEqual({ cursor: null, hasNext: false });
    expect(page.totalCount).toBe(0);
  });

  it('throws on a null repository', () => {
    const data = { ...fixture('empty-page'), repository: null };
    expect(() => parseIssuesPage(data)).toThrow(/repository/i);
  });
});
