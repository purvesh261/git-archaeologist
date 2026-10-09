import type { DefaultJobOptions } from 'bullmq';

export const INGESTION_QUEUE = 'ingestion';

export const JobName = {
  RepoStats: 'repo-stats',
} as const;

export interface RepoStatsJobData {
  repoId: number;
}

// Job-level retry is the outer safety net: the GitHub client already retries
// individual requests, so reaching this means something stayed broken for a while.
export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};
