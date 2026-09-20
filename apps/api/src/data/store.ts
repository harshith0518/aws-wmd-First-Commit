export type Key = { pk: string; sk: string };
export type Item = Key & Record<string, unknown>;
export type Guard =
  | { kind: 'absent' }
  | { kind: 'version'; version: number }
  | { kind: 'expired'; now: number }
  | { kind: 'member'; version: number; now: string };
export type Write = { table: string; key: Key; guard: Guard; item?: Item };
export type Query = {
  table: string;
  pk: string;
  prefix?: string;
  index?: 'gsi1' | 'gsi2' | 'ready';
  sortAtMost?: string;
  limit: number;
  descending?: boolean;
  after?: Key;
};
export type Page = { items: Item[]; next?: Key };
export interface Store {
  get(table: string, key: Key): Promise<Item | undefined>;
  query(input: Query): Promise<Page>;
  transact(writes: Write[]): Promise<void>;
}
export class WriteConflict extends Error {}
