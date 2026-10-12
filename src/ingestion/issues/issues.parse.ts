import type { RawItem } from '../backfill.store.js';
import type { IssuesPageResponse, RateLimit } from './issues.queries.js';

export interface IssuesPage {
  items: RawItem[];
  /** Issue numbers whose comments or timeline did not fit in the page. */
  overflow: number[];
  next: { cursor: string | null; hasNext: boolean };
  totalCount: number;
  rateLimit: RateLimit;
}

export function parseIssuesPage(data: IssuesPageResponse): IssuesPage {
  if (!data.repository) {
    throw new Error('GitHub returned no repository for the issues page');
  }
  const { nodes, pageInfo, totalCount } = data.repository.issues;
  return {
    items: nodes.map((n) => ({
      kind: 'issue',
      externalId: String(n.number),
      payload: n,
    })),
    overflow: nodes
      .filter(
        (n) =>
          n.comments.pageInfo.hasNextPage || n.timelineItems.pageInfo.hasNextPage,
      )
      .map((n) => n.number),
    next: { cursor: pageInfo.endCursor, hasNext: pageInfo.hasNextPage },
    totalCount,
    rateLimit: data.rateLimit,
  };
}
