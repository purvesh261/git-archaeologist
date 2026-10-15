import type { Job } from 'bullmq';
import { IngestionProcessor } from './ingestion.processor.js';
import type { IssuesBackfillJob } from './issues/issues-backfill.job.js';
import type { PrsBackfillJob } from './prs/prs-backfill.job.js';
import type { RepoStatsJob } from './repo-stats.job.js';
import type { ThreadJob } from './thread.job.js';

describe('IngestionProcessor', () => {
  const repoStats = { run: vi.fn(async () => 'stats') };
  const issuesBackfill = { run: vi.fn(async () => 'backfill') };
  const threadJob = { run: vi.fn(async () => 'thread') };
  const prsBackfill = { run: vi.fn(async () => 'prs') };
  const processor = new IngestionProcessor(
    repoStats as unknown as RepoStatsJob,
    issuesBackfill as unknown as IssuesBackfillJob,
    threadJob as unknown as ThreadJob,
    prsBackfill as unknown as PrsBackfillJob,
  );
  const job = (name: string, data: unknown) => ({ name, data }) as Job;

  it('routes each job name to its handler', async () => {
    const stats = job('repo-stats', { repoId: 1 });
    await expect(processor.process(stats)).resolves.toBe('stats');
    expect(repoStats.run).toHaveBeenCalledWith({ repoId: 1 });

    const backfill = job('issues-backfill', { repoId: 1 });
    await expect(processor.process(backfill)).resolves.toBe('backfill');
    // the BullMQ job is passed through for progress reporting
    expect(issuesBackfill.run).toHaveBeenCalledWith({ repoId: 1 }, backfill);

    await expect(processor.process(job('nope', {}))).rejects.toThrow(
      'Unknown job: nope',
    );
  });

  it('routes legacy issue-thread data to ThreadJob', async () => {
    const thread = job('issue-thread', { repoId: 1, issueNumber: 7 });
    await expect(processor.process(thread)).resolves.toBe('thread');
    expect(threadJob.run).toHaveBeenCalledWith({ repoId: 1, kind: 'issue', number: 7 });
  });

  it('routes prs-backfill and pr-thread', async () => {
    const prs = job('prs-backfill', { repoId: 1 });
    await expect(processor.process(prs)).resolves.toBe('prs');
    expect(prsBackfill.run).toHaveBeenCalledWith({ repoId: 1 }, prs);

    await expect(processor.process(job('pr-thread', { repoId: 1, prNumber: 5 }))).resolves.toBe(
      'thread',
    );
    expect(threadJob.run).toHaveBeenCalledWith({ repoId: 1, kind: 'pr', number: 5 });
  });
});
