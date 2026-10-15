// node:sqlite 的最小类型声明（@types/node 20.x 尚未自带）
// 只声明项目实际用到的方法，多余成员已裁剪。
declare module 'node:sqlite' {
  export interface RunResult {}
  export class StatementSync {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
  export class DatabaseSync {
    constructor(path?: string | Buffer);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
