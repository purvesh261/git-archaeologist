import { Module } from '@nestjs/common';
import { createOctokit, GithubClient, OCTOKIT } from './github.client.js';
import { EnvTokenProvider, TokenProvider } from './token-provider.js';

@Module({
  providers: [
    { provide: TokenProvider, useClass: EnvTokenProvider },
    { provide: OCTOKIT, useFactory: createOctokit, inject: [TokenProvider] },
    GithubClient,
  ],
  exports: [GithubClient],
})
export class GithubModule {}
