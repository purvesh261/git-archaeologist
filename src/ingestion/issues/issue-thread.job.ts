import { Injectable, Logger } from '@nestjs/common';
import { GithubClient } from '../../github/github.client.js';
import type { IssueThreadJobData } from '../../queue/queues.js';
import { ReposService } from '../../repos/repos.service.js';
import { BackfillStore } from '../backfill.store.js';
import {
  ISSUE_THREAD_QUERY,
  type IssueThreadResponse,
} from './issues.queries.js';

/**
 * Fetches the full comments and timeline of one issue whose thread overflowed
 * the backfill page. Always starts from the beginning, so re-runs are idempotent.
 */
@Injectable()
export class IssueThreadJob {
  private readonly logger = new Logger(IssueThreadJob.name);

  constructor(
    private readonly github: GithubClient,
    private readonly repos: ReposService,
    private readonly store: BackfillStore,
  ) {}

  async run({
    repoId,
    issueNumber,
  }: IssueThreadJobData): Promise<{ comments: number; timelineItems: number }> {
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
