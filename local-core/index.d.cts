export type JsonValue = string | number | boolean | null | JsonValue[] | { [name: string]: JsonValue };

export interface ArtifactReceiptInput {
  bytes: Uint8Array;
  sizeBytes: number;
  sha256: string;
}

/** Compare the exact byte count and lowercase SHA-256 digest of the supplied view. */
export function verifyArtifactReceipt(input: ArtifactReceiptInput): boolean;

export interface ToolContext {
  readonly taskId: string;
  readonly tool: string;
}

/** A trusted in-process handler. Return plain JSON data or a promise for that data. */
export type ToolHandler<Input = unknown> = {
  handle(input: Input, context: ToolContext): unknown;
}['handle'];

type ToolRegistry = Record<string, ToolHandler>;

export interface LocalAgentOptions<Tools extends ToolRegistry = ToolRegistry> {
  tools: Tools;
  allowedTools: readonly string[];
  blockedTools?: readonly string[];
  /** Number of terminal records retained in completion order. Defaults to 100. */
  historyLimit?: number;
}

interface TaskIdentity {
  id: string;
  tool: string;
}

export type TaskRecord = TaskIdentity & (
  | { status: 'running'; result: null; error: null }
  | { status: 'completed'; result: JsonValue; error: null }
  | { status: 'blocked'; result: null; error: { code: 'tool_blocked' } }
  | { status: 'failed'; result: null; error: { code: 'tool_failed' | 'invalid_result' } }
);

export type FinishedTask = Exclude<TaskRecord, { status: 'running' }>;

export interface TaskRun {
  readonly id: string;
  readonly done: Promise<FinishedTask>;
}

type ToolInput<Tools extends ToolRegistry, Name extends string> =
  Name extends keyof Tools ? Parameters<Tools[Name]> extends [] ? unknown : Parameters<Tools[Name]>[0] : unknown;

export class LocalAgent<Tools extends ToolRegistry = ToolRegistry> {
  constructor(options: LocalAgentOptions<Tools>);
  start<Name extends string>(tool: Name, input: ToolInput<Tools, Name>): TaskRun;
  run<Name extends string>(tool: Name, input: ToolInput<Tools, Name>): Promise<FinishedTask>;
  get(taskId: string): TaskRecord | undefined;
}
