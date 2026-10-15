import type { BackfillPage } from '../paged-backfill.runner.js';
import type { PrsPageResponse } from './prs.queries.js';

export function parsePrsPage(data: PrsPageResponse): BackfillPage {
  if (!data.repository) {
    throw new Error('GitHub returned no repository for the PRs page');
  }
  const { nodes, pageInfo, totalCount } = data.repository.pullRequests;
  return {
    items: nodes.map((n) => ({ kind: 'pr', externalId: String(n.number), payload: n })),
    overflow: nodes.filter((n) => n.comments.pageInfo.hasNextPage).map((n) => n.number),
    next: { cursor: pageInfo.endCursor, hasNext: pageInfo.hasNextPage },
    totalCount,
    rateLimit: data.rateLimit,
  };
}
