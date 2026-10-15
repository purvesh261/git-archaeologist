import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CoreModule } from './core.module.js';
import { BackfillStore } from './ingestion/backfill.store.js';
import {
  commitsBackfillJobId,
  INGESTION_QUEUE,
  issuesBackfillJobId,
  JobName,
  prsBackfillJobId,
  type RepoStatsJobData,
} from './queue/queues.js';
import { ReposService } from './repos/repos.service.js';

@Module({ imports: [CoreModule], providers: [BackfillStore] })
class CliModule {}

const USAGE = `Usage:
  npm run cli -- repo:add <owner>/<name>   register a repo and enqueue its stats job
  npm run cli -- backfill:issues <owner>/<name> [--restart]
                                           enqueue the issues backfill (resumes; --restart starts over)
  npm run cli -- backfill:prs <owner>/<name> [--restart]
                                           enqueue the PRs backfill (resumes; --restart starts over)
  npm run cli -- backfill:commits <owner>/<name>
                                           enqueue the commits backfill (always re-reads the whole log)`;

// Backfill commands; `restart` is false where there's no cursor to reset.
const BACKFILLS: Record<string, { name: string; jobId: (repoId: number) => string; restart: boolean }> = {
  'backfill:issues': { name: JobName.IssuesBackfill, jobId: issuesBackfillJobId, restart: true },
  'backfill:prs': { name: JobName.PrsBackfill, jobId: prsBackfillJobId, restart: true },
  'backfill:commits': { name: JobName.CommitsBackfill, jobId: commitsBackfillJobId, restart: false },
};

async function enqueueBackfill(
  app: INestApplicationContext,
  queue: Queue,
  backfill: (typeof BACKFILLS)[string],
  arg: string | undefined,
  flag: string | undefined,
): Promise<void> {
  const [owner, name] = (arg ?? '').split('/');
  if (!owner || !name || (flag && !(backfill.restart && flag === '--restart'))) {
    throw new Error(USAGE);
  }
  const repo = await app.get(ReposService).upsert(owner, name);
  const jobId = backfill.jobId(repo.id);

  // BullMQ keeps finished jobs, and add() with their id is a silent no-op.
  const existing = await queue.getJob(jobId);
  const state = await existing?.getState();
  if (existing && state !== 'completed' && state !== 'failed') {
    console.log(`${jobId} is already ${state}; not enqueuing`);
    return;
  }
  await existing?.remove();

  if (flag === '--restart') {
    await app.get(BackfillStore).reset(repo.id, backfill.name);
  }
  const job = await queue.add(backfill.name, { repoId: repo.id }, { jobId });
  console.log(`repo ${repo.owner}/${repo.name} = id ${repo.id}; enqueued ${job.name} #${job.id}`);
}

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
      default:
        if (command && Object.hasOwn(BACKFILLS, command)) {
          await enqueueBackfill(app, queue, BACKFILLS[command], arg, flag);
        } else {
          console.log(USAGE);
        }
    }
  } finally {
    await app.close();
  }
}

await main(process.argv.slice(2));
