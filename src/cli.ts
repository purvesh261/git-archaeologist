import { getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { CoreModule } from './core.module.js';
import {
  INGESTION_QUEUE,
  JobName,
  type RepoStatsJobData,
} from './queue/queues.js';
import { ReposService } from './repos/repos.service.js';

@Module({ imports: [CoreModule] })
class CliModule {}

const USAGE = `Usage:
  npm run cli -- repo:add <owner>/<name>   register a repo and enqueue its stats job`;

async function main(argv: string[]): Promise<void> {
  const [command, arg] = argv;
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
        console.log(USAGE);
    }
  } finally {
    await app.close();
  }
}

await main(process.argv.slice(2));
