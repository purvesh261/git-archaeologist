import type { DefaultJobOptions } from 'bullmq';

export const INGESTION_QUEUE = 'ingestion';

export const JobName = {
  RepoStats: 'repo-stats',
  IssuesBackfill: 'issues-backfill',
  IssueThread: 'issue-thread',
} as const;

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

// Deterministic ids dedupe re-enqueues. BullMQ rejects ':' in custom ids.
export const issuesBackfillJobId = (repoId: number) =>
  `issues-backfill-${repoId}`;
export const issueThreadJobId = (repoId: number, issueNumber: number) =>
  `issue-thread-${repoId}-${issueNumber}`;

// Job-level retry is the outer safety net: the GitHub client already retries
// individual requests, so reaching this means something stayed broken for a while.
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};
