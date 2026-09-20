import { App } from 'aws-cdk-lib';
import { CampusFixStack } from './stack.js';
const app = new App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'ap-south-1';
if (!account || !/^\d{12}$/.test(account))
  throw new Error('Set CDK_DEFAULT_ACCOUNT using your authenticated AWS account.');
if (region !== 'ap-south-1') throw new Error('This checked release targets Mumbai (ap-south-1).');
new CampusFixStack(app, 'CampusFixDemo', { env: { account, region } });
