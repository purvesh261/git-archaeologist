import { Inject, Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/core';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { TokenProvider } from './token-provider.js';

const GithubOctokit = Octokit.plugin(throttling, retry);
export type GithubOctokit = InstanceType<typeof GithubOctokit>;

export const OCTOKIT = Symbol('OCTOKIT');

// How many times one request may wait out a rate limit before giving up and
// letting BullMQ's job-level retry take over.
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Builds the single Octokit instance all GitHub traffic goes through.
 * - plugin-throttling queues requests, and on a primary or secondary rate
 *   limit (REST 403/429, or GraphQL `RATE_LIMITED`) waits until reset.
 * - plugin-retry retries 5xx and network errors with backoff.
 */
export function createOctokit(tokens: TokenProvider): GithubOctokit {
  const logger = new Logger('GithubOctokit');
  const onLimit = (
    kind: string,
    retryAfter: number,
    options: { method: string; url: string },
    retryCount: number,
  ): boolean => {
    logger.warn(
      `${kind} rate limit on ${options.method} ${options.url}; ` +
        `retry ${retryCount + 1}/${MAX_RATE_LIMIT_RETRIES} in ${retryAfter}s`,
    );
    return retryCount < MAX_RATE_LIMIT_RETRIES;
  };

  const octokit = new GithubOctokit({
    userAgent: 'git-archaeologist',
    throttle: {
      onRateLimit: (retryAfter, options, _o, retryCount) =>
        onLimit('Primary', retryAfter, options, retryCount),
      onSecondaryRateLimit: (retryAfter, options, _o, retryCount) =>
        onLimit('Secondary', retryAfter, options, retryCount),
    },
  });

  octokit.hook.before('request', async (options) => {
    options.headers.authorization = `token ${await tokens.getToken()}`;
  });

  return octokit;
}

export interface GraphqlErrorItem {
  type?: string;
  message: string;
  path?: (string | number)[];
}

export class GithubGraphqlError extends Error {
  constructor(readonly errors: GraphqlErrorItem[]) {
    super(errors.map((e) => `${e.type ?? 'ERROR'}: ${e.message}`).join('; '));
    this.name = 'GithubGraphqlError';
  }
}

/**
 * The only way the app talks to GitHub. Inject it only into BullMQ job
 * handlers: GithubModule is imported by WorkerModule and nothing else.
 */
@Injectable()
export class GithubClient {
  constructor(@Inject(OCTOKIT) private readonly octokit: GithubOctokit) {}

  async graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.octokit.request('POST /graphql', {
      query,
      variables,
    });
    const body = res.data as { data?: T; errors?: GraphqlErrorItem[] };
    // GraphQL reports most failures as HTTP 200 with an `errors` array.
    // Rate-limit errors never reach here; the throttling plugin handles them.
    if (body.errors?.length) {
      throw new GithubGraphqlError(body.errors);
    }
    if (body?.data === undefined) {
      // Keep the evidence: without status and body this error is undiagnosable.
      const snippet = (JSON.stringify(res.data) ?? String(res.data)).slice(0, 300);
      throw new Error(
        `GitHub GraphQL response had neither data nor errors (HTTP ${res.status}): ${snippet}`,
      );
    }
    return body.data;
  }
}
