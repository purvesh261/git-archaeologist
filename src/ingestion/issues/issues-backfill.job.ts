import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { JobName, type IssuesBackfillJobData } from '../../queue/queues.js';
import { PagedBackfillRunner } from '../paged-backfill.runner.js';
import { parseIssuesPage } from './issues.parse.js';
import { ISSUES_PAGE_QUERY, type IssuesPageResponse } from './issues.queries.js';

/** Pages through every issue of a repo, newest first, with comments and link events. */
@Injectable()
export class IssuesBackfillJob {
  constructor(private readonly runner: PagedBackfillRunner) {}

  async run(
    data: IssuesBackfillJobData,
    job?: Job,
  ): Promise<{ pages: number; issues: number; overflow: number }> {
    const { pages, items, overflow } = await this.runner.run<IssuesPageResponse>(
      {
        job: JobName.IssuesBackfill,
        label: 'issues',
        query: ISSUES_PAGE_QUERY,
        parse: parseIssuesPage,
        threadKind: 'issue',
      },
      data,
      job,
    );
    return { pages, issues: items, overflow };
  }
}
