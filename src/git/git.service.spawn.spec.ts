import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { text } from 'node:stream/consumers';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

// A child that fails to start: 'error' fires while stdout is still being read.
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    setTimeout(() => {
      child.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
      setTimeout(() => child.stdout.end(), 20);
    }, 0);
    return child;
  },
}));

const { GitService } = await import('./git.service.js');

describe('GitService.spawnLog when git cannot start', () => {
  it('fails the stream instead of raising an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const svc = new GitService({ get: () => '/tmp' } as unknown as ConfigService<Env, true>);
      await expect(text(svc.spawnLog('/tmp/x.git', ['log']))).rejects.toThrow(/ENOENT/);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
