import type { Job } from 'bullmq';
import { IngestionProcessor } from './ingestion.processor.js';
import type { IssueThreadJob } from './issues/issue-thread.job.js';
import type { IssuesBackfillJob } from './issues/issues-backfill.job.js';
import type { RepoStatsJob } from './repo-stats.job.js';

describe('IngestionProcessor', () => {
  const repoStats = { run: vi.fn(async () => 'stats') };
  const issuesBackfill = { run: vi.fn(async () => 'backfill') };
  const issueThread = { run: vi.fn(async () => 'thread') };
  const processor = new IngestionProcessor(
    repoStats as unknown as RepoStatsJob,
    issuesBackfill as unknown as IssuesBackfillJob,
    issueThread as unknown as IssueThreadJob,
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

    const thread = job('issue-thread', { repoId: 1, issueNumber: 9 });
    await expect(processor.process(thread)).resolves.toBe('thread');
    expect(issueThread.run).toHaveBeenCalledWith({ repoId: 1, issueNumber: 9 });

    await expect(processor.process(job('nope', {}))).rejects.toThrow(
      'Unknown job: nope',
    );
  });
});
