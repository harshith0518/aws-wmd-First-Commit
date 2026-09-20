import { handle } from 'hono/aws-lambda';
import { createRuntime } from './runtime.js';
export const handler = handle(createRuntime().app);
