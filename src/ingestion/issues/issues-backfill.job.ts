import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { GithubClient } from '../../github/github.client.js';
import {
  INGESTION_QUEUE,
  issueThreadJobId,
  JobName,
  type IssuesBackfillJobData,
  type IssueThreadJobData,
} from '../../queue/queues.js';
import { ReposService } from '../../repos/repos.service.js';
import { BackfillStore } from '../backfill.store.js';
import { parseIssuesPage } from './issues.parse.js';
import { ISSUES_PAGE_QUERY, type IssuesPageResponse } from './issues.queries.js';

const DEFAULT_PAGE_SIZE = 50;
const INNER_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 5;

// GitHub kills GraphQL requests over 10 s with a 502/504; a smaller page usually fits.
const isTimeout = (err: unknown) =>
  [502, 504].includes((err as { status?: unknown }).status as number);

/**
 * Pages through every issue of a repo, newest first. Each page's rows and the
 * next cursor commit together, so a crashed run resumes with no gaps or dupes.
 */
@Injectable()
export class IssuesBackfillJob {
  private readonly logger = new Logger(IssuesBackfillJob.name);

  constructor(
    private readonly github: GithubClient,
    private readonly repos: ReposService,
    private readonly store: BackfillStore,
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue,
  ) {}

  async run(
    { repoId, pageSize = DEFAULT_PAGE_SIZE }: IssuesBackfillJobData,
    job?: Job,
  ): Promise<{ pages: number; issues: number; overflow: number }> {
    const repo = await this.repos.get(repoId);
    const slug = `${repo.owner}/${repo.name}`;
    const totals = { pages: 0, issues: 0, overflow: 0 };

    const state = await this.store.getCursor(repoId, JobName.IssuesBackfill);
    if (state?.completedAt) {
      this.logger.log(`${slug}: issues backfill already complete; use --restart to redo`);
      return totals;
    }

    let after = state?.cursor ?? null;
    let first = pageSize;
    const startedAt = Date.now();

    for (;;) {
      let data: IssuesPageResponse;
      try {
        data = await this.github.graphql<IssuesPageResponse>(ISSUES_PAGE_QUERY, {
          owner: repo.owner,
          name: repo.name,
          first,
          after,
          inner: INNER_PAGE_SIZE,
        });
      } catch (err) {
        if (!isTimeout(err) || first <= MIN_PAGE_SIZE) throw err;
        first = Math.max(MIN_PAGE_SIZE, Math.floor(first / 2));
        this.logger.warn(`${slug}: GitHub timed out; retrying with page size ${first}`);
        continue;
      }

      const page = parseIssuesPage(data);
      const done = !page.next.hasNext;
      // An empty last page has a null endCursor; keep the one we resumed from.
      const cursor = page.next.cursor ?? after;

      // Before the save: if we die in between, the resume re-enqueues (deduped by
      // jobId) instead of skipping this page's threads forever.
      if (page.overflow.length) {
        await this.queue.addBulk(
          page.overflow.map((issueNumber) => ({
            name: JobName.IssueThread,
            data: { repoId, issueNumber } satisfies IssueThreadJobData,
            opts: { jobId: issueThreadJobId(repoId, issueNumber) },
          })),
        );
      }
      await this.store.savePage(repoId, JobName.IssuesBackfill, page.items, {
        cursor,
        done,
      });

      totals.pages++;
      totals.issues += page.items.length;
      totals.overflow += page.overflow.length;
      await job?.updateProgress({
        pages: totals.pages,
        issues: totals.issues,
        totalCount: page.totalCount,
      });

      // shortcut: ETA counts only this run's issues, so it overestimates after a resume; fine for a log line.
      const msPerIssue = (Date.now() - startedAt) / Math.max(totals.issues, 1);
      const etaMin = Math.round(
        (msPerIssue * Math.max(page.totalCount - totals.issues, 0)) / 60_000,
      );
      this.logger.log(
        `${slug}: page ${totals.pages}, ${totals.issues}/${page.totalCount} issues this run, ` +
          `${totals.overflow} overflow, ${page.rateLimit.remaining} points left, ETA ~${etaMin} min`,
      );

      if (done) return totals;
      after = cursor;
    }
  }
}
