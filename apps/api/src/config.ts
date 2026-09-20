import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['local', 'test', 'production']).default('local'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  AWS_REGION: z
    .string()
    .regex(/^[a-z]{2}-[a-z]+-\d$/)
    .default('ap-south-1'),
  CORE_TABLE: z.string().min(3).default('campusfix-local-core'),
  DISCOVERY_TABLE: z.string().min(3).default('campusfix-local-discovery'),
  JOBS_TABLE: z.string().min(3).default('campusfix-local-jobs'),
  DYNAMODB_ENDPOINT: z.url().optional(),
  COGNITO_ISSUER: z.url().optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  COGNITO_DOMAIN: z.url().optional(),
  CURSOR_SECRET: z.string().min(32).optional(),
  WORKFLOW_SCHEDULE_ARN: z
    .string()
    .regex(/^arn:aws:events:[a-z0-9-]+:\d{12}:rule\/[A-Za-z0-9_-]+$/)
    .optional(),
  FILE_SCHEDULE_ARN: z
    .string()
    .regex(/^arn:aws:events:[a-z0-9-]+:\d{12}:rule\/[A-Za-z0-9_-]+$/)
    .optional(),
  FILES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  QUARANTINE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .optional(),
  EVIDENCE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
    .optional(),
  GUARD_DUTY_PLAN_ARN: z
    .string()
    .regex(/^arn:aws:guardduty:[a-z0-9-]+:\d{12}:malware-protection-plan\/[A-Za-z0-9-]+$/)
    .optional(),
});
export type Config = z.infer<typeof envSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid environment fields: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  const c = parsed.data;
  if (
    c.DYNAMODB_ENDPOINT &&
    !['http://127.0.0.1:8000', 'http://localhost:8000'].includes(c.DYNAMODB_ENDPOINT)
  )
    throw new Error('DYNAMODB_ENDPOINT may only target the local database.');
  if (
    c.COGNITO_ISSUER &&
    !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/.test(c.COGNITO_ISSUER)
  )
    throw new Error('COGNITO_ISSUER must be an AWS Cognito user-pool issuer.');
  if (
    c.COGNITO_DOMAIN &&
    (new URL(c.COGNITO_DOMAIN).protocol !== 'https:' ||
      new URL(c.COGNITO_DOMAIN).origin !== c.COGNITO_DOMAIN)
  )
    throw new Error('COGNITO_DOMAIN must be an HTTPS origin.');
  const auth = [c.COGNITO_ISSUER, c.COGNITO_CLIENT_ID, c.COGNITO_DOMAIN];
  if (auth.some(Boolean) && !auth.every(Boolean))
    throw new Error('Configure all three Cognito settings together.');
  if (
    c.APP_ENV === 'production' &&
    (c.DYNAMODB_ENDPOINT ||
      !auth.every(Boolean) ||
      !c.CURSOR_SECRET ||
      [c.CORE_TABLE, c.JOBS_TABLE, c.DISCOVERY_TABLE].some((t) => t.includes('local')))
  )
    throw new Error(
      'Production requires Cognito, a cursor secret and explicit production tables; local endpoints are forbidden.',
    );
  if (
    c.FILES_ENABLED &&
    (!c.QUARANTINE_BUCKET ||
      !c.EVIDENCE_BUCKET ||
      !c.GUARD_DUTY_PLAN_ARN ||
      c.QUARANTINE_BUCKET === c.EVIDENCE_BUCKET)
  )
    throw new Error(
      'Enabled evidence requires separate versioned buckets and an approved GuardDuty plan.',
    );
  return c;
}
