import { Injectable, Logger } from '@nestjs/common';
import { GithubClient } from '../github/github.client.js';
import type { ThreadKind } from '../queue/queues.js';
import { ReposService } from '../repos/repos.service.js';
import { BackfillStore } from './backfill.store.js';
import {
  ISSUE_THREAD_QUERY,
  type IssueThreadResponse,
} from './issues/issues.queries.js';

export interface ThreadJobData {
  repoId: number;
  kind: ThreadKind;
  number: number;
}

/**
 * Fetches the full thread of one issue or PR that overflowed its backfill page.
 * Always starts from the beginning, so re-runs are idempotent.
 */
@Injectable()
export class ThreadJob {
  private readonly logger = new Logger(ThreadJob.name);

  constructor(
    private readonly github: GithubClient,
    private readonly repos: ReposService,
    private readonly store: BackfillStore,
  ) {}

  async run({
    repoId,
    kind,
    number: issueNumber,
  }: ThreadJobData): Promise<{ comments: number; timelineItems: number }> {
    if (kind === 'pr') throw new Error('pr threads: not implemented');
    const repo = await this.repos.get(repoId);
    const comments: unknown[] = [];
    const timelineItems: unknown[] = [];
    let commentsAfter: string | null = null;
    let timelineAfter: string | null = null;
    let withComments = true;
    let withTimeline = true;
    let fetchedPages = 0;

    while (withComments || withTimeline) {
      const data: IssueThreadResponse = await this.github.graphql(
        ISSUE_THREAD_QUERY,
        {
          owner: repo.owner,
          name: repo.name,
          number: issueNumber,
          commentsAfter,
          timelineAfter,
          withComments,
          withTimeline,
        },
      );
      const issue = data.repository?.issue;
      if (!issue) {
        throw new Error(`${repo.owner}/${repo.name}#${issueNumber} not found`);
      }
      fetchedPages++;

      if (withComments && issue.comments) {
        comments.push(...issue.comments.nodes);
        commentsAfter = issue.comments.pageInfo.endCursor;
        withComments = issue.comments.pageInfo.hasNextPage;
      }
      if (withTimeline && issue.timelineItems) {
        timelineItems.push(...issue.timelineItems.nodes);
        timelineAfter = issue.timelineItems.pageInfo.endCursor;
        withTimeline = issue.timelineItems.pageInfo.hasNextPage;
      }
    }

    await this.store.saveItems(repoId, [
      {
        kind: 'issue_thread',
        externalId: String(issueNumber),
        payload: { comments, timelineItems, fetchedPages },
      },
    ]);
    this.logger.log(
      `${repo.owner}/${repo.name}#${issueNumber}: ${comments.length} comments, ` +
        `${timelineItems.length} timeline items in ${fetchedPages} requests`,
    );
    return { comments: comments.length, timelineItems: timelineItems.length };
  }
}
