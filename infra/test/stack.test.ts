import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CampusFixStack } from '../stack.js';
const assets = mkdtempSync(join(tmpdir(), 'campusfix-infra-test-'));
writeFileSync(join(assets, 'lambda.mjs'), 'export const handler = async () => {};');
const app = new App();
const stack = new CampusFixStack(app, 'CampusFixDemo', {
  env: { account: '111111111111', region: 'ap-south-1' },
  assetPath: assets,
});
const t = Template.fromStack(stack);
test('all business API routes require Cognito access-token scope; health alone is public', () => {
  const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')) as {
    Properties: Record<string, unknown>;
  }[];
  assert.equal(routes.length, 3);
  for (const route of routes) {
    const p = route.Properties;
    if (String(p.RouteKey).includes('/api/v1/')) {
      assert.equal(p.AuthorizationType, 'JWT');
      assert.deepEqual(p.AuthorizationScopes, ['campusfix/api']);
    } else {
      assert.ok(['GET /health', 'GET /api/health'].includes(String(p.RouteKey)));
      assert.equal(p.AuthorizationType, 'NONE');
    }
  }
  t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
    CorsConfiguration: {
      AllowOrigins: Match.arrayWith([Match.objectLike({ 'Fn::Join': Match.anyValue() })]),
    },
  });
});
test('production Lambda has fail-closed configuration, Linux runtime and no scan/file/model IAM', () => {
  t.resourceCountIs('AWS::Lambda::Function', 2);
  t.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs24.x',
    Architectures: ['x86_64'],
    MemorySize: 512,
    Timeout: 29,
    Environment: {
      Variables: Match.objectLike({
        APP_ENV: 'production',
        FILES_ENABLED: 'false',
        CURSOR_SECRET: Match.anyValue(),
        COGNITO_CLIENT_ID: Match.anyValue(),
      }),
    },
  });
  const policies = JSON.stringify(t.findResources('AWS::IAM::Policy'));
  assert.doesNotMatch(policies, /dynamodb:Scan|bedrock:|s3:PutObject|AdministratorAccess/);
  assert.doesNotMatch(
    JSON.stringify(t.toJSON()),
    /DYNAMODB_ENDPOINT|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/,
  );
  t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(5 minutes)' });
});
test('private web origin and retained tables use planned keys and TTL', () => {
  t.resourceCountIs('AWS::DynamoDB::Table', 3);
  for (const table of Object.values(t.findResources('AWS::DynamoDB::Table')) as {
    Properties: Record<string, unknown>;
    DeletionPolicy: string;
  }[]) {
    assert.equal(table.Properties.BillingMode, 'PAY_PER_REQUEST');
    assert.equal(table.Properties.DeletionProtectionEnabled, true);
    assert.equal(table.DeletionPolicy, 'Retain');
  }
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    GlobalSecondaryIndexes: Match.arrayWith([
      Match.objectLike({ IndexName: 'ready', Projection: { ProjectionType: 'KEYS_ONLY' } }),
    ]),
  });
  t.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
  t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
});
test('Cognito uses code grant with no secret, no public signup and exact CloudFront callbacks', () => {
  t.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    UserPoolTier: 'LITE',
  });
  t.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    GenerateSecret: false,
    AllowedOAuthFlows: ['code'],
    AllowedOAuthScopes: Match.arrayWith(['openid', 'email', 'profile']),
    CallbackURLs: Match.arrayWith([Match.objectLike({ 'Fn::Join': Match.anyValue() })]),
  });
});
test('SPA rewrite serves real page paths without hiding missing assets', () => {
  const code = readFileSync(new URL('../spa-rewrite.js', import.meta.url), 'utf8');
  const rewrite = (uri: string, method = 'GET') =>
    runInNewContext(code + '\nhandler(event)', { event: { request: { uri, method } } }).uri;
  for (const uri of [
    '/',
    '/auth/callback',
    '/campuses',
    '/c/abc-123/staff/queue',
    '/c/abc-123/service-reviews/new',
    '/c/abc-123/library/new',
  ])
    assert.equal(rewrite(uri), '/index.html');
  for (const uri of [
    '/assets/missing.js',
    '/favicon.ico',
    '/not-a-route',
    '/c/abc-123/library/bad.js',
  ])
    assert.equal(rewrite(uri), uri);
  assert.equal(rewrite('/campuses', 'POST'), '/campuses');
});
test('template has no resource dependency cycle including Cognito callback and API URLs', () => {
  const resources = t.toJSON().Resources as Record<string, unknown>;
  const graph = new Map<string, Set<string>>();
  function references(value: unknown, result: Set<string>) {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    if (typeof v.Ref === 'string' && resources[v.Ref]) result.add(v.Ref);
    const att = v['Fn::GetAtt'];
    if (Array.isArray(att) && resources[String(att[0])]) result.add(String(att[0]));
    if (Array.isArray(v.DependsOn)) {
      for (const dep of v.DependsOn) if (resources[String(dep)]) result.add(String(dep));
    } else if (typeof v.DependsOn === 'string' && resources[v.DependsOn]) result.add(v.DependsOn);
    for (const child of Object.values(v)) references(child, result);
  }
  for (const [id, r] of Object.entries(resources)) {
    const refs = new Set<string>();
    references(r, refs);
    graph.set(id, refs);
  }
  function visit(id: string, path: Set<string>) {
    assert.ok(!path.has(id), `Dependency cycle at ${[...path, id].join(' -> ')}`);
    for (const dep of graph.get(id) ?? []) visit(dep, new Set([...path, id]));
  }
  for (const id of graph.keys()) visit(id, new Set());
});
