import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Construct } from 'constructs';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
  aws_s3 as s3,
  aws_cloudfront as cf,
  aws_cloudfront_origins as origins,
  aws_dynamodb as db,
  aws_cognito as cognito,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_iam as iam,
  aws_apigatewayv2 as gateway,
  aws_apigatewayv2_integrations as integrations,
  aws_apigatewayv2_authorizers as authorizers,
  aws_secretsmanager as secrets,
  aws_events as events,
  aws_events_targets as targets,
  aws_cloudwatch as metrics,
} from 'aws-cdk-lib';
const root = fileURLToPath(new URL('../', import.meta.url));
export class CampusFixStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { assetPath?: string } = {}) {
    super(scope, id, props);
    Tags.of(this).add('Project', 'CampusFix');
    Tags.of(this).add('Environment', 'demo');
    // One demo stack avoids cross-stack callback cycles. This is not the real-campus pilot.
    const web = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const headers = new cf.ResponseHeadersPolicy(this, 'WebHeaders', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cf.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cf.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; connect-src 'self' https://*.execute-api.${this.region}.amazonaws.com https://cognito-idp.${this.region}.amazonaws.com https://*.auth.${this.region}.amazoncognito.com; form-action 'self'`,
        },
      },
    });
    const navigation = new cf.Function(this, 'Navigation', {
      runtime: cf.FunctionRuntime.JS_2_0,
      code: cf.FunctionCode.fromInline(readFileSync(resolve(root, 'infra/spa-rewrite.js'), 'utf8')),
    });
    const distribution = new cf.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      priceClass: cf.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web as s3.IBucket),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
        // Honour S3 cache headers; index.html must never inherit a nonzero minimum TTL.
        cachePolicy: new cf.CachePolicy(this, 'WebCache', {
          minTtl: Duration.seconds(0),
          defaultTtl: Duration.seconds(0),
          maxTtl: Duration.days(365),
          enableAcceptEncodingBrotli: true,
          enableAcceptEncodingGzip: true,
        }),
        responseHeadersPolicy: headers,
        functionAssociations: [
          { function: navigation, eventType: cf.FunctionEventType.VIEWER_REQUEST },
        ],
      },
    });
    const webUrl = `https://${distribution.distributionDomainName}`;
    const pool = new cognito.UserPool(this, 'Users', {
      userPoolName: 'campusfix-demo',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: { email: { required: true, mutable: true } },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.NONE,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
      featurePlan: cognito.FeaturePlan.LITE,
    });
    const scopeApi = new cognito.ResourceServerScope({
      scopeName: 'api',
      scopeDescription: 'CampusFix authenticated API',
    });
    const resource = pool.addResourceServer('ApiScope', {
      identifier: 'campusfix',
      scopes: [scopeApi],
    });
    const client = pool.addClient('Browser', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: { userSrp: true },
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.resourceServer(resource, scopeApi),
        ],
        callbackUrls: [`${webUrl}/auth/callback`],
        logoutUrls: [`${webUrl}/`],
      },
    });
    const domain = pool.addDomain('Login', {
      cognitoDomain: { domainPrefix: `campusfix-demo-${this.account}-${this.region}` },
      managedLoginVersion: cognito.ManagedLoginVersion.CLASSIC_HOSTED_UI,
    });
    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${pool.userPoolId}`;
    const tables = Object.fromEntries(
      ['core', 'discovery', 'jobs'].map((name) => {
        const table = new db.Table(this, name, {
          partitionKey: { name: 'pk', type: db.AttributeType.STRING },
          sortKey: { name: 'sk', type: db.AttributeType.STRING },
          billingMode: db.BillingMode.PAY_PER_REQUEST,
          encryption: db.TableEncryption.AWS_MANAGED,
          removalPolicy: RemovalPolicy.RETAIN,
          deletionProtection: true,
          ...(name === 'jobs' ? { timeToLiveAttribute: 'expiresAt' } : {}),
        });
        for (const index of name === 'core' ? ['gsi1', 'gsi2'] : name === 'jobs' ? ['ready'] : []) {
          table.addGlobalSecondaryIndex({
            indexName: index,
            partitionKey: {
              name: index === 'ready' ? 'readyPk' : `${index}pk`,
              type: db.AttributeType.STRING,
            },
            sortKey: {
              name: index === 'ready' ? 'readySk' : `${index}sk`,
              type: db.AttributeType.STRING,
            },
            projectionType: db.ProjectionType.KEYS_ONLY,
          });
        }
        return [name, table];
      }),
    ) as Record<'core' | 'discovery' | 'jobs', db.Table>;
    const cursor = new secrets.Secret(this, 'CursorKey', {
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const ruleName = 'campusfix-demo-transfer-expiry';
    const env = {
      APP_ENV: 'production',
      CORE_TABLE: tables.core.tableName,
      DISCOVERY_TABLE: tables.discovery.tableName,
      JOBS_TABLE: tables.jobs.tableName,
      COGNITO_ISSUER: issuer,
      COGNITO_CLIENT_ID: client.userPoolClientId,
      COGNITO_DOMAIN: domain.baseUrl(),
      CURSOR_SECRET: cursor.secretValue.unsafeUnwrap(),
      FILES_ENABLED: 'false',
      WORKFLOW_SCHEDULE_ARN: this.formatArn({
        service: 'events',
        resource: 'rule',
        resourceName: ruleName,
      }),
    };
    const code = lambda.Code.fromAsset(props.assetPath ?? resolve(root, '.artifacts/lambda'));
    const fn = (id: string, handler: string) => {
      const logGroup = new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const f = new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.X86_64,
        code,
        handler,
        memorySize: 512,
        timeout: Duration.seconds(29),
        environment: env,
        logGroup,
      });
      f.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'dynamodb:GetItem',
            'dynamodb:Query',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:ConditionCheckItem',
          ],
          resources: Object.values(tables).flatMap((t) => [t.tableArn, `${t.tableArn}/index/*`]),
        }),
      );
      new metrics.Alarm(this, `${id}Errors`, {
        metric: f.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: metrics.TreatMissingData.NOT_BREACHING,
      });
      return f;
    };
    const apiFn = fn('Api', 'lambda.handler');
    const worker = fn('Transfers', 'workers/workflow.handler');
    new events.Rule(this, 'TransferSchedule', {
      ruleName,
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [
        new targets.LambdaFunction(worker, { retryAttempts: 2, maxEventAge: Duration.hours(1) }),
      ],
    });
    const integration = new integrations.HttpLambdaIntegration('Hono', apiFn);
    const api = new gateway.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: [webUrl],
        allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
        allowMethods: [
          gateway.CorsHttpMethod.GET,
          gateway.CorsHttpMethod.POST,
          gateway.CorsHttpMethod.PUT,
          gateway.CorsHttpMethod.PATCH,
          gateway.CorsHttpMethod.DELETE,
          gateway.CorsHttpMethod.OPTIONS,
        ],
        exposeHeaders: ['X-Request-Id', 'Retry-After'],
        maxAge: Duration.minutes(10),
      },
    });
    const auth = new authorizers.HttpJwtAuthorizer('Cognito', issuer, {
      jwtAudience: [client.userPoolClientId],
    });
    api.addRoutes({
      path: '/api/v1/{proxy+}',
      methods: [gateway.HttpMethod.ANY],
      integration,
      authorizer: auth,
      authorizationScopes: ['campusfix/api'],
    });
    for (const path of ['/health', '/api/health'])
      api.addRoutes({ path, methods: [gateway.HttpMethod.GET], integration });
    const stage = api.defaultStage!.node.defaultChild as gateway.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };
    for (const [name, value] of Object.entries({
      WebUrl: webUrl,
      WebBucket: web.bucketName,
      DistributionId: distribution.distributionId,
      ApiUrl: api.apiEndpoint,
      UserPoolId: pool.userPoolId,
      ClientId: client.userPoolClientId,
      CognitoDomain: domain.baseUrl(),
      CognitoIssuer: issuer,
      CoreTable: tables.core.tableName,
      DiscoveryTable: tables.discovery.tableName,
      JobsTable: tables.jobs.tableName,
      ApiFunction: apiFn.functionName,
      Region: this.region,
      Account: this.account,
      ReleaseStage: 'demo',
    }))
      new CfnOutput(this, name, { value });
  }
}
