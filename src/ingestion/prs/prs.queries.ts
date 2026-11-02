import {
  COMMENT_FRAGMENTS,
  type Connection,
  type PageInfo,
  type RateLimit,
} from '../issues/issues.queries.js';

// Newest first, like issues. No PR timeline: issue timelines already hold the
// cross-references, and review comments wait for v1.1.
export const PRS_PAGE_QUERY = /* GraphQL */ `
  query PrsPage(
    $owner: String!
    $name: String!
    $first: Int!
    $after: String
    $inner: Int!
  ) {
    rateLimit {
      cost
      remaining
      resetAt
    }
    repository(owner: $owner, name: $name) {
      pullRequests(
        first: $first
        after: $after
        orderBy: { field: CREATED_AT, direction: DESC }
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          body
          state
          createdAt
          updatedAt
          closedAt
          merged
          mergedAt
          mergeCommit {
            oid
          }
          baseRefName
          url
          author {
            ...Actor
          }
          authorAssociation
          labels(first: 20) {
            nodes {
              name
            }
          }
          closingIssuesReferences(first: 10) {
            totalCount
            nodes {
              number
              url
            }
          }
          comments(first: $inner) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ...Comment
            }
          }
        }
      }
    }
  }
  ${COMMENT_FRAGMENTS}
`;

export const PR_THREAD_QUERY = /* GraphQL */ `
  query PrThread(
    $owner: String!
    $name: String!
    $number: Int!
    $commentsAfter: String
  ) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        comments(first: 100, after: $commentsAfter) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...Comment
          }
        }
      }
    }
  }
  ${COMMENT_FRAGMENTS}
`;

export interface PrNode {
  number: number;
  comments: Connection<unknown>;
  [field: string]: unknown;
}

export interface PrsPageResponse {
  rateLimit: RateLimit;
  repository: { pullRequests: Connection<PrNode> } | null;
}

export interface PrThreadResponse {
  repository: {
    pullRequest: { comments: { pageInfo: PageInfo; nodes: unknown[] } } | null;
  } | null;
}
