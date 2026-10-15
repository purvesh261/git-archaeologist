import { Injectable, Logger } from '@nestjs/common';
import { GithubClient } from '../github/github.client.js';
import type { ThreadKind } from '../queue/queues.js';
import { ReposService } from '../repos/repos.service.js';
import { BackfillStore } from './backfill.store.js';
import {
  ISSUE_THREAD_QUERY,
  type IssueThreadResponse,
} from './issues/issues.queries.js';
import { PR_THREAD_QUERY, type PrThreadResponse } from './prs/prs.queries.js';

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
    number,
  }: ThreadJobData): Promise<{ comments: number; timelineItems: number }> {
    const repo = await this.repos.get(repoId);
    const isPr = kind === 'pr';
    const comments: unknown[] = [];
    const timelineItems: unknown[] = [];
    let commentsAfter: string | null = null;
    let timelineAfter: string | null = null;
    let withComments = true;
    // PR threads are comments only (see PRS_PAGE_QUERY).
    let withTimeline = !isPr;
    let fetchedPages = 0;

    while (withComments || withTimeline) {
      const vars: Record<string, unknown> = { owner: repo.owner, name: repo.name, number, commentsAfter };
      const thread:
        | NonNullable<PrThreadResponse['repository']>['pullRequest']
        | NonNullable<IssueThreadResponse['repository']>['issue']
        | undefined = isPr
        ? (await this.github.graphql<PrThreadResponse>(PR_THREAD_QUERY, vars))
            .repository?.pullRequest
        : (
            await this.github.graphql<IssueThreadResponse>(ISSUE_THREAD_QUERY, {
              ...vars,
              timelineAfter,
              withComments,
              withTimeline,
            })
          ).repository?.issue;
      if (!thread) {
        throw new Error(`${repo.owner}/${repo.name}#${number} not found`);
      }
      fetchedPages++;

      if (withComments && thread.comments) {
        comments.push(...thread.comments.nodes);
        commentsAfter = thread.comments.pageInfo.endCursor;
        withComments = thread.comments.pageInfo.hasNextPage;
      }
      if (withTimeline && 'timelineItems' in thread && thread.timelineItems) {
        timelineItems.push(...thread.timelineItems.nodes);
        timelineAfter = thread.timelineItems.pageInfo.endCursor;
        withTimeline = thread.timelineItems.pageInfo.hasNextPage;
      }
    }

    await this.store.saveItems(repoId, [
      {
        kind: `${kind}_thread`,
        externalId: String(number),
        payload: isPr
          ? { comments, fetchedPages }
          : { comments, timelineItems, fetchedPages },
      },
    ]);
    this.logger.log(
      `${repo.owner}/${repo.name}#${number}: ${comments.length} comments, ` +
        `${timelineItems.length} timeline items in ${fetchedPages} requests`,
    );
    return { comments: comments.length, timelineItems: timelineItems.length };
  }
}
