import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  INGESTION_QUEUE,
  JobName,
  type RepoStatsJobData,
} from '../queue/queues.js';
import { RepoStatsJob } from './repo-stats.job.js';

// Concurrency 1: every job shares one GitHub token's rate limit, so running
// jobs in parallel would only make them wait on each other.
@Processor(INGESTION_QUEUE, { concurrency: 1 })
export class IngestionProcessor extends WorkerHost {
  constructor(private readonly repoStats: RepoStatsJob) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case JobName.RepoStats:
        return this.repoStats.run(job.data as RepoStatsJobData);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }
}
