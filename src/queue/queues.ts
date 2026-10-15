import type { DefaultJobOptions } from 'bullmq';

export const INGESTION_QUEUE = 'ingestion';

export const JobName = {
  RepoStats: 'repo-stats',
  IssuesBackfill: 'issues-backfill',
  IssueThread: 'issue-thread',
  PrsBackfill: 'prs-backfill',
  PrThread: 'pr-thread',
  CommitsBackfill: 'commits-backfill',
} as const;

export type ThreadKind = 'issue' | 'pr';

export interface RepoStatsJobData {
  repoId: number;
}

export interface IssuesBackfillJobData {
  repoId: number;
  pageSize?: number;
}

export interface IssueThreadJobData {
  repoId: number;
  issueNumber: number;
}

export interface PrsBackfillJobData {
  repoId: number;
  pageSize?: number;
}

export interface PrThreadJobData {
  repoId: number;
  prNumber: number;
}

// Deterministic ids dedupe re-enqueues. BullMQ rejects ':' in custom ids.
export const issuesBackfillJobId = (repoId: number) =>
  `issues-backfill-${repoId}`;
export const prsBackfillJobId = (repoId: number) => `prs-backfill-${repoId}`;
export const threadJobId = (repoId: number, kind: ThreadKind, number: number) =>
  `${kind}-thread-${repoId}-${number}`;

/** The overflow job for one issue or PR. */
export const threadJob = (repoId: number, kind: ThreadKind, number: number) => ({
  name: kind === 'issue' ? JobName.IssueThread : JobName.PrThread,
  data:
    kind === 'issue'
      ? ({ repoId, issueNumber: number } satisfies IssueThreadJobData)
      : ({ repoId, prNumber: number } satisfies PrThreadJobData),
  // Dedupe only while queued; a kept completed job would block --restart's refetch.
  opts: { jobId: threadJobId(repoId, kind, number), removeOnComplete: true },
});

// Job-level retry is the outer safety net: the GitHub client already retries
// individual requests, so reaching this means something stayed broken for a while.
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};
