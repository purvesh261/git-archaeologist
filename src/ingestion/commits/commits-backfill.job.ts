import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { GitService } from '../../git/git.service.js';
import { JobName, type CommitsBackfillJobData } from '../../queue/queues.js';
import { ReposService } from '../../repos/repos.service.js';
import { BackfillStore, type RawItem } from '../backfill.store.js';
import { GIT_LOG_ARGS, parseCommitRecord, splitRecords } from './commits.parse.js';

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Stores every commit message on the default branch from a local bare clone; no API
 * calls. No resume: re-reading the whole log takes seconds, and a rerun is the refresh.
 */
@Injectable()
export class CommitsBackfillJob {
  private readonly logger = new Logger(CommitsBackfillJob.name);

  constructor(
    private readonly git: GitService,
    private readonly repos: ReposService,
    private readonly store: BackfillStore,
  ) {}

  async run(
    { repoId, batchSize = DEFAULT_BATCH_SIZE }: CommitsBackfillJobData,
    job?: Job,
  ): Promise<{ commits: number; head: string }> {
    const repo = await this.repos.get(repoId);
    const slug = `${repo.owner}/${repo.name}`;
    const gitDir = await this.git.ensureClone(repo);
    const head = (await this.git.run(gitDir, ['rev-parse', 'HEAD'])).trim();

    let batch: RawItem[] = [];
    let commits = 0;
    for await (const record of splitRecords(this.git.spawnLog(gitDir, GIT_LOG_ARGS))) {
      batch.push(parseCommitRecord(record));
      if (batch.length < batchSize) continue;
      await this.store.saveItems(repoId, batch);
      commits += batch.length;
      batch = [];
      await job?.updateProgress({ commits });
      this.logger.log(`${slug}: ${commits} commits saved`);
    }
    // The last batch commits with the HEAD sha and completed_at, so "complete" means every row is in.
    await this.store.savePage(repoId, JobName.CommitsBackfill, batch, { cursor: head, done: true });
    commits += batch.length;
    this.logger.log(`${slug}: commits backfill complete, ${commits} commits up to ${head}`);
    return { commits, head };
  }
}
