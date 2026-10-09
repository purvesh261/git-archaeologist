import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { GithubClient } from '../github/github.client.js';
import type { RepoStatsJobData } from '../queue/queues.js';
import { ReposService } from '../repos/repos.service.js';

const REPO_STATS_QUERY = /* GraphQL */ `
  query RepoStats($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      createdAt
      issues {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      pullRequests {
        totalCount
      }
      mergedPullRequests: pullRequests(states: MERGED) {
        totalCount
      }
      defaultBranchRef {
        name
        target {
          ... on Commit {
            history {
              totalCount
            }
          }
        }
      }
    }
  }
`;

export interface RepoStats {
  repository: {
    createdAt: string;
    issues: { totalCount: number };
    closedIssues: { totalCount: number };
    pullRequests: { totalCount: number };
    mergedPullRequests: { totalCount: number };
    defaultBranchRef: {
      name: string;
      target: { history?: { totalCount: number } };
    } | null;
  } | null;
}

/** Fetches item counts for a repo; the totals that corpus sizing extrapolates from. */
@Injectable()
export class RepoStatsJob {
  private readonly logger = new Logger(RepoStatsJob.name);

  constructor(
    private readonly github: GithubClient,
    private readonly repos: ReposService,
    private readonly db: DatabaseService,
  ) {}

  async run({ repoId }: RepoStatsJobData): Promise<RepoStats> {
    const repo = await this.repos.get(repoId);
    const stats = await this.github.graphql<RepoStats>(REPO_STATS_QUERY, {
      owner: repo.owner,
      name: repo.name,
    });
    if (!stats.repository) {
      throw new Error(`GitHub has no repository ${repo.owner}/${repo.name}`);
    }

    await this.db.query(
      `insert into raw_items (repo_id, kind, external_id, payload)
       values ($1, 'repo', 'stats', $2)
       on conflict (repo_id, kind, external_id)
       do update set payload = excluded.payload, fetched_at = now()`,
      [repoId, stats],
    );

    const r = stats.repository;
    this.logger.log(
      `${repo.owner}/${repo.name}: ${r.issues.totalCount} issues ` +
        `(${r.closedIssues.totalCount} closed), ${r.pullRequests.totalCount} PRs ` +
        `(${r.mergedPullRequests.totalCount} merged), ` +
        `${r.defaultBranchRef?.target.history?.totalCount ?? '?'} commits`,
    );
    return stats;
  }
}
