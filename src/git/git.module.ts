import { Module } from '@nestjs/common';
import { GitService } from './git.service.js';

@Module({ providers: [GitService], exports: [GitService] })
export class GitModule {}
