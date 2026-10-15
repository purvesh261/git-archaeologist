import type { BackfillPage } from '../paged-backfill.runner.js';
import type { IssuesPageResponse } from './issues.queries.js';

export type IssuesPage = BackfillPage;

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
