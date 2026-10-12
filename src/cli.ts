import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { CoreModule } from './core.module.js';
import { BackfillStore } from './ingestion/backfill.store.js';
import {
  INGESTION_QUEUE,
  issuesBackfillJobId,
  JobName,
  type IssuesBackfillJobData,
  type RepoStatsJobData,
} from './queue/queues.js';
import { ReposService } from './repos/repos.service.js';

@Module({ imports: [CoreModule], providers: [BackfillStore] })
class CliModule {}

const USAGE = `Usage:
  npm run cli -- repo:add <owner>/<name>   register a repo and enqueue its stats job
  npm run cli -- backfill:issues <owner>/<name> [--restart]
                                           enqueue the issues backfill (resumes; --restart starts over)`;

async function main(argv: string[]): Promise<void> {
  const [command, arg, flag] = argv;
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const repos = app.get(ReposService);
    const queue = app.get<Queue>(getQueueToken(INGESTION_QUEUE));

    switch (command) {
      case 'repo:add': {
        const [owner, name] = (arg ?? '').split('/');
        if (!owner || !name) throw new Error(USAGE);
        const repo = await repos.upsert(owner, name);
        const data: RepoStatsJobData = { repoId: repo.id };
        const job = await queue.add(JobName.RepoStats, data);
        console.log(
          `repo ${repo.owner}/${repo.name} = id ${repo.id}; enqueued ${job.name} #${job.id}`,
        );
        break;
      }
      case 'backfill:issues': {
        const [owner, name] = (arg ?? '').split('/');
        if (!owner || !name || (flag && flag !== '--restart')) {
          throw new Error(USAGE);
        }
        const repo = await repos.upsert(owner, name);
        const jobId = issuesBackfillJobId(repo.id);

        // BullMQ keeps finished jobs, and add() with their id is a silent no-op.
        const existing = await queue.getJob(jobId);
        const state = await existing?.getState();
        if (existing && state !== 'completed' && state !== 'failed') {
          console.log(`${jobId} is already ${state}; not enqueuing`);
          break;
        }
        await existing?.remove();

        if (flag === '--restart') {
          await app.get(BackfillStore).reset(repo.id, JobName.IssuesBackfill);
        }
        const data: IssuesBackfillJobData = { repoId: repo.id };
        const job = await queue.add(JobName.IssuesBackfill, data, { jobId });
        console.log(
          `repo ${repo.owner}/${repo.name} = id ${repo.id}; enqueued ${job.name} #${job.id}`,
        );
        break;
      }
      default:
        console.log(USAGE);
    }
  } finally {
    await app.close();
  }
}

await main(process.argv.slice(2));
