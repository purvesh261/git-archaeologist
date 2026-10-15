import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { GithubModule } from './github/github.module.js';
import { BackfillStore } from './ingestion/backfill.store.js';
import { IngestionProcessor } from './ingestion/ingestion.processor.js';
import { IssuesBackfillJob } from './ingestion/issues/issues-backfill.job.js';
import { PagedBackfillRunner } from './ingestion/paged-backfill.runner.js';
import { RepoStatsJob } from './ingestion/repo-stats.job.js';
import { ThreadJob } from './ingestion/thread.job.js';

/** The worker process: the only module allowed to import GithubModule. */
@Module({
  imports: [CoreModule, GithubModule],
  providers: [
    IngestionProcessor,
    RepoStatsJob,
    BackfillStore,
    IssuesBackfillJob,
    PagedBackfillRunner,
    ThreadJob,
  ],
})
export class WorkerModule {}
