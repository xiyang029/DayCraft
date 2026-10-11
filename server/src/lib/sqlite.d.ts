// node:sqlite 的最小类型声明（@types/node 20.x 尚未自带）
declare module 'node:sqlite' {
  export interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }
  export class StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>;
    setAllowBareNamedParameters(enabled: boolean): void;
    setAllowUnknownNamedParameters(enabled: boolean): void;
    setReadBigInts(enabled: boolean): void;
    columns(): Array<{ name: string; columnType: unknown; [key: string]: unknown }>;
    sourceSQL: string;
    expandedSQL: string;
  }
  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
    timeout?: number;
    readBigInts?: boolean;
    allowBareNamedParameters?: boolean;
    allowUnknownNamedParameters?: boolean;
  }
  export class DatabaseSync {
    constructor(path?: string | Buffer, options?: DatabaseSyncOptions);
    open(): void;
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    createSession(options?: object): unknown;
    applyChangeset(changeset: Uint8Array, options?: object): boolean;
  }
}
