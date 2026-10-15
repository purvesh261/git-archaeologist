// Timeline events that link an issue to the PR, commit or issue where it was
// resolved; everything else on the timeline (labels, assignees…) is noise for "why".
const TIMELINE_TYPES =
  '[CROSS_REFERENCED_EVENT, CLOSED_EVENT, MARKED_AS_DUPLICATE_EVENT, CONNECTED_EVENT, REFERENCED_EVENT]';

const FRAGMENTS = /* GraphQL */ `
  fragment Actor on Actor {
    __typename
    login
  }

  fragment Ref on ReferencedSubject {
    __typename
    ... on Issue {
      number
      url
    }
    ... on PullRequest {
      number
      url
    }
  }

  fragment Comment on IssueComment {
    id
    author {
      ...Actor
    }
    authorAssociation
    body
    createdAt
    url
  }

  fragment TimelineItem on IssueTimelineItems {
    __typename
    ... on CrossReferencedEvent {
      createdAt
      isCrossRepository
      willCloseTarget
      source {
        ...Ref
      }
    }
    ... on ClosedEvent {
      createdAt
      stateReason
      closer {
        __typename
        ... on PullRequest {
          number
          url
        }
        ... on Commit {
          oid
          url
        }
      }
    }
    ... on MarkedAsDuplicateEvent {
      createdAt
      isCrossRepository
      canonical {
        __typename
        ... on Issue {
          number
          url
        }
        ... on PullRequest {
          number
          url
        }
      }
    }
    ... on ConnectedEvent {
      createdAt
      isCrossRepository
      subject {
        ...Ref
      }
    }
    ... on ReferencedEvent {
      createdAt
      isCrossRepository
      commit {
        oid
        url
      }
    }
  }
`;

// Newest first: positions never shift under CREATED_AT, and recent history lands first.
export const ISSUES_PAGE_QUERY = /* GraphQL */ `
  query IssuesPage(
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
      issues(
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
          stateReason
          createdAt
          updatedAt
          closedAt
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
          timelineItems(first: $inner, itemTypes: ${TIMELINE_TYPES}) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              ...TimelineItem
            }
          }
        }
      }
    }
  }
  ${FRAGMENTS}
`;

// $withComments/$withTimeline drop a connection once it is exhausted, so the
// other one can keep paging without re-requesting (and resetting) the finished one.
export const ISSUE_THREAD_QUERY = /* GraphQL */ `
  query IssueThread(
    $owner: String!
    $name: String!
    $number: Int!
    $commentsAfter: String
    $timelineAfter: String
    $withComments: Boolean!
    $withTimeline: Boolean!
  ) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(first: 100, after: $commentsAfter)
          @include(if: $withComments) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...Comment
          }
        }
        timelineItems(
          first: 100
          after: $timelineAfter
          itemTypes: ${TIMELINE_TYPES}
        ) @include(if: $withTimeline) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ...TimelineItem
          }
        }
      }
    }
  }
  ${FRAGMENTS}
`;

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Connection<N> {
  totalCount: number;
  pageInfo: PageInfo;
  nodes: N[];
}

export interface IssueNode {
  number: number;
  comments: Connection<unknown>;
  timelineItems: Connection<unknown>;
  [field: string]: unknown;
}

export interface RateLimit {
  cost: number;
  remaining: number;
  resetAt: string;
}

export interface IssuesPageResponse {
  rateLimit: RateLimit;
  repository: { issues: Connection<IssueNode> } | null;
}

export interface IssueThreadResponse {
  repository: {
    issue: {
      comments?: Omit<Connection<unknown>, 'totalCount'>;
      timelineItems?: Omit<Connection<unknown>, 'totalCount'>;
    } | null;
  } | null;
}
