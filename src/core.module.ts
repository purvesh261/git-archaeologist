import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { defaultJobOptions, INGESTION_QUEUE } from './queue/queues.js';
import { ReposService } from './repos/repos.service.js';

function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
  };
}

/**
 * Shared by every process: config, database, and the queue *producer*.
 * Contains no processors and no GitHub client, so importing it never starts
 * a worker or makes an API call.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisConnection(config.get('REDIS_URL', { infer: true })),
        defaultJobOptions,
      }),
    }),
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
  ],
  providers: [ReposService],
  exports: [BullModule, ReposService],
})
export class CoreModule {}
