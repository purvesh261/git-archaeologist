import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

/**
 * Supplies the token for each GitHub request. v0 uses a personal access
 * token; v4 swaps in GitHub App installation tokens (which expire hourly)
 * without touching the client or any job.
 */
export abstract class TokenProvider {
  abstract getToken(): Promise<string>;
}

@Injectable()
export class EnvTokenProvider extends TokenProvider {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  getToken(): Promise<string> {
    const token = this.config.get('GITHUB_TOKEN', { infer: true });
    if (!token) {
      return Promise.reject(new Error('GITHUB_TOKEN is not set'));
    }
    return Promise.resolve(token);
  }
}
