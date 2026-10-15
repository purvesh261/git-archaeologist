import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  INGESTION_QUEUE,
  JobName,
  type IssuesBackfillJobData,
  type IssueThreadJobData,
  type PrsBackfillJobData,
  type PrThreadJobData,
  type RepoStatsJobData,
} from '../queue/queues.js';
import { IssuesBackfillJob } from './issues/issues-backfill.job.js';
import { PrsBackfillJob } from './prs/prs-backfill.job.js';
import { RepoStatsJob } from './repo-stats.job.js';
import { ThreadJob } from './thread.job.js';

// Concurrency 1: every job shares one GitHub token's rate limit, so running
// jobs in parallel would only make them wait on each other.
@Processor(INGESTION_QUEUE, { concurrency: 1 })
export class IngestionProcessor extends WorkerHost {
  constructor(
    private readonly repoStats: RepoStatsJob,
    private readonly issuesBackfill: IssuesBackfillJob,
    private readonly thread: ThreadJob,
    private readonly prsBackfill: PrsBackfillJob,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JobName.RepoStats:
        return this.repoStats.run(job.data as RepoStatsJobData);
      case JobName.IssuesBackfill:
        return this.issuesBackfill.run(job.data as IssuesBackfillJobData, job);
      case JobName.IssueThread: {
        const { repoId, issueNumber } = job.data as IssueThreadJobData;
        return this.thread.run({ repoId, kind: 'issue', number: issueNumber });
      }
      case JobName.PrsBackfill:
        return this.prsBackfill.run(job.data as PrsBackfillJobData, job);
      case JobName.PrThread: {
        const { repoId, prNumber } = job.data as PrThreadJobData;
        return this.thread.run({ repoId, kind: 'pr', number: prNumber });
      }
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }
}
