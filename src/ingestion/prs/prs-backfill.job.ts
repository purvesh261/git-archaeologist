import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobName, type PrsBackfillJobData } from '../../queue/queues.js';
import { PagedBackfillRunner } from '../paged-backfill.runner.js';
import { parsePrsPage } from './prs.parse.js';
import { PRS_PAGE_QUERY, type PrsPageResponse } from './prs.queries.js';

/** Pages through every PR of a repo, newest first, with comments and closing references. */
@Injectable()
export class PrsBackfillJob {
  constructor(private readonly runner: PagedBackfillRunner) {}

  async run(
    data: PrsBackfillJobData,
    job?: Job,
  ): Promise<{ pages: number; prs: number; overflow: number }> {
    const { pages, items, overflow } = await this.runner.run<PrsPageResponse>(
      {
        job: JobName.PrsBackfill,
        label: 'prs',
        query: PRS_PAGE_QUERY,
        parse: parsePrsPage,
        threadKind: 'pr',
      },
      data,
      job,
    );
    return { pages, prs: items, overflow };
  }
}
