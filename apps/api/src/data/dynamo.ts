import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Config } from '../config.js';
import { type Store, type Item, type Key, type Query, type Write, WriteConflict } from './store.js';

export class DynamoStore implements Store {
  readonly client: DynamoDBDocumentClient;
  constructor(config: Config) {
    const raw = new DynamoDBClient({
      region: config.AWS_REGION,
      maxAttempts: 3,
      ...(config.DYNAMODB_ENDPOINT
        ? {
            endpoint: config.DYNAMODB_ENDPOINT,
            credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
          }
        : {}),
    });
    this.client = DynamoDBDocumentClient.from(raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  async get(table: string, key: Key) {
    const r = await this.client.send(
      new GetCommand({ TableName: table, Key: key, ConsistentRead: true }),
    );
    return r.Item as Item | undefined;
  }
  async query(q: Query) {
    if (q.prefix && q.sortAtMost) throw new Error('Only one sort-key condition is supported.');
    const pk = q.index === 'ready' ? 'readyPk' : q.index ? `${q.index}pk` : 'pk';
    const sk = q.index === 'ready' ? 'readySk' : q.index ? `${q.index}sk` : 'sk';
    const r = await this.client.send(
      new QueryCommand({
        TableName: q.table,
        ...(q.index ? { IndexName: q.index } : { ConsistentRead: true }),
        KeyConditionExpression:
          '#pk = :pk' +
          (q.prefix ? ' AND begins_with(#sk, :prefix)' : q.sortAtMost ? ' AND #sk <= :max' : ''),
        ExpressionAttributeNames: { '#pk': pk, ...(q.prefix || q.sortAtMost ? { '#sk': sk } : {}) },
        ExpressionAttributeValues: {
          ':pk': q.pk,
          ...(q.prefix ? { ':prefix': q.prefix } : {}),
          ...(q.sortAtMost ? { ':max': q.sortAtMost } : {}),
        },
        Limit: q.limit,
        ScanIndexForward: !q.descending,
        ...(q.after ? { ExclusiveStartKey: q.after } : {}),
      }),
    );
    return {
      items: (r.Items ?? []) as Item[],
      ...(r.LastEvaluatedKey ? { next: r.LastEvaluatedKey as Key } : {}),
    };
  }
  async transact(writes: Write[]) {
    if (!writes.length || writes.length > 100) throw new Error('Invalid transaction size.');
    for (const w of writes)
      if (w.item && Buffer.byteLength(JSON.stringify(w.item)) > 64 * 1024)
        throw new Error('Item exceeds 64 KB.');
    const items = writes.map((w) => {
      const condition =
        w.guard.kind === 'member'
          ? {
              ConditionExpression:
                '#version = :version AND #status = :active AND (attribute_not_exists(expiresAt) OR expiresAt > :now)',
              ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
              ExpressionAttributeValues: {
                ':version': w.guard.version,
                ':active': 'ACTIVE',
                ':now': w.guard.now.replace(/\.\d{3}Z$/, 'Z'),
              },
            }
          : w.guard.kind === 'absent'
            ? { ConditionExpression: 'attribute_not_exists(pk)' }
            : w.guard.kind === 'version'
              ? {
                  ConditionExpression: '#version = :version',
                  ExpressionAttributeNames: { '#version': 'version' },
                  ExpressionAttributeValues: { ':version': w.guard.version },
                }
              : {
                  ConditionExpression: 'attribute_not_exists(pk) OR expiresAt <= :now',
                  ExpressionAttributeValues: { ':now': w.guard.now },
                };
      if (w.item && w.delete) throw new Error('A write cannot put and delete the same item.');
      if (w.delete) return { Delete: { TableName: w.table, Key: w.key, ...condition } };
      return w.item
        ? { Put: { TableName: w.table, Item: w.item, ...condition } }
        : { ConditionCheck: { TableName: w.table, Key: w.key, ...condition } };
    });
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (e) {
      if (
        e instanceof Error &&
        e.name === 'TransactionCanceledException' &&
        'CancellationReasons' in e &&
        (e.CancellationReasons as { Code?: string }[] | undefined)?.some((r) =>
          ['ConditionalCheckFailed', 'TransactionConflict'].includes(r.Code ?? ''),
        )
      )
        throw new WriteConflict('Conditional transaction conflict.');
      throw e;
    }
  }
}
