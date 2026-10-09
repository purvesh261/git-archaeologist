import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { GithubModule } from './github/github.module.js';
import { IngestionProcessor } from './ingestion/ingestion.processor.js';
import { RepoStatsJob } from './ingestion/repo-stats.job.js';

/** The worker process: the only module allowed to import GithubModule. */
@Module({
  imports: [CoreModule, GithubModule],
  providers: [IngestionProcessor, RepoStatsJob],
})
export class WorkerModule {}
