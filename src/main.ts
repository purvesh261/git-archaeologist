import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

// The worker has no HTTP surface yet; it just consumes BullMQ jobs.
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
