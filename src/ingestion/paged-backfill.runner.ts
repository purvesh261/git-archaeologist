import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { GithubClient, GithubGraphqlError } from '../github/github.client.js';
import { INGESTION_QUEUE, threadJob, type ThreadKind } from '../queue/queues.js';
import { ReposService } from '../repos/repos.service.js';
import { BackfillStore, type RawItem } from './backfill.store.js';
import type { RateLimit } from './issues/issues.queries.js';

const DEFAULT_PAGE_SIZE = 50;
const INNER_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 5;

// A page too heavy for GitHub fails as a 502/504, a 200 whose error mentions a
// timeout, or RESOURCE_LIMITS_EXCEEDED with null nested nodes; a smaller page fits.
const isTooHeavy = (err: unknown) =>
  [502, 504].includes((err as { status?: unknown }).status as number) ||
  (err instanceof GithubGraphqlError &&
    err.errors.some(
      (e) => e.type === 'RESOURCE_LIMITS_EXCEEDED' || /timeout/i.test(e.message),
    ));

export interface BackfillPage {
  items: RawItem[];
  /** Numbers of items whose nested connections did not fit in the page. */
  overflow: number[];
  next: { cursor: string | null; hasNext: boolean };
  totalCount: number;
  rateLimit: RateLimit;
}

export interface PagedBackfillSpec<R> {
  /** sync_cursors.job, e.g. JobName.IssuesBackfill. */
  job: string;
  /** Plural noun for logs and the progress key, e.g. 'issues'. */
  label: string;
  /** Takes the variables owner, name, first, after, inner. */
  query: string;
  parse(data: R): BackfillPage;
  /** Thread job enqueued for each overflow item. */
  threadKind: ThreadKind;
}

/**
 * Pages through a repo's GraphQL connection, newest first. Each page's rows and
 * the next cursor commit together, so a crashed run resumes with no gaps or dupes.
 */
@Injectable()
export class PagedBackfillRunner {
  private readonly logger = new Logger(PagedBackfillRunner.name);

  constructor(
    private readonly github: GithubClient,
    private readonly repos: ReposService,
    private readonly store: BackfillStore,
    @InjectQueue(INGESTION_QUEUE) private readonly queue: Queue,
  ) {}

  async run<R>(
    spec: PagedBackfillSpec<R>,
    { repoId, pageSize = DEFAULT_PAGE_SIZE }: { repoId: number; pageSize?: number },
    job?: Job,
  ): Promise<{ pages: number; items: number; overflow: number }> {
    const repo = await this.repos.get(repoId);
    const slug = `${repo.owner}/${repo.name}`;
    const totals = { pages: 0, items: 0, overflow: 0 };

    const state = await this.store.getCursor(repoId, spec.job);
    if (state?.completedAt) {
      this.logger.log(`${slug}: ${spec.label} backfill already complete; use --restart to redo`);
      return totals;
    }

    let after = state?.cursor ?? null;
    let first = pageSize;
    let inner = INNER_PAGE_SIZE;
    const startedAt = Date.now();

    for (;;) {
      let data: R;
      try {
        data = await this.github.graphql<R>(spec.query, {
          owner: repo.owner,
          name: repo.name,
          first,
          after,
          inner,
        });
      } catch (err) {
        if (!isTooHeavy(err) || first <= MIN_PAGE_SIZE) throw err;
        // Shrink the nested pages too: one item with 50 huge comments can time out alone.
        first = Math.max(MIN_PAGE_SIZE, Math.floor(first / 2));
        inner = Math.max(MIN_PAGE_SIZE, Math.floor(inner / 2));
        this.logger.warn(
          `${slug}: page too heavy for GitHub; retrying with page size ${first}/${inner}`,
        );
        continue;
      }

      const page = spec.parse(data);
      const done = !page.next.hasNext;
      // An empty last page has a null endCursor; keep the one we resumed from.
      const cursor = page.next.cursor ?? after;

      // Before the save: if we die in between, the resume re-enqueues (deduped by
      // jobId) instead of skipping this page's threads forever.
      if (page.overflow.length) {
        await this.queue.addBulk(
          page.overflow.map((n) => threadJob(repoId, spec.threadKind, n)),
        );
      }
      await this.store.savePage(repoId, spec.job, page.items, { cursor, done });

      totals.pages++;
      totals.items += page.items.length;
      totals.overflow += page.overflow.length;
      await job?.updateProgress({
        pages: totals.pages,
        [spec.label]: totals.items,
        totalCount: page.totalCount,
      });

      // shortcut: ETA counts only this run's items, so it overestimates after a resume; fine for a log line.
      const msPerItem = (Date.now() - startedAt) / Math.max(totals.items, 1);
      const etaMin = Math.round(
        (msPerItem * Math.max(page.totalCount - totals.items, 0)) / 60_000,
      );
      this.logger.log(
        `${slug}: page ${totals.pages}, ${totals.items}/${page.totalCount} ${spec.label} this run, ` +
          `${totals.overflow} overflow, ${page.rateLimit.remaining} points left, ETA ~${etaMin} min`,
      );

      if (done) return totals;
      after = cursor;
    }
  }
}
