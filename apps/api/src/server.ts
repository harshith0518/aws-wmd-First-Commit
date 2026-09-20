import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createRuntime } from './runtime.js';
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { app, config } = createRuntime();
const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) =>
  console.log(`CampusFix API: http://${config.HOST}:${info.port}/api/health`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
