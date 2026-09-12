import { type LogLevel, type LoggerService } from '@nestjs/common';

/**
 * Structured logging (T-071, D-044): one JSON object per line on stdout, so
 * a log shipper or `jq` can filter by level, context, request id or event
 * without parsing prose. In development (`LOG_FORMAT=pretty`) the same
 * records are printed for a human. Nothing here buffers or ships logs; the
 * process writes, the platform collects (Docker, then whatever fronts it).
 */
export type LogFormat = 'json' | 'pretty';

export interface LogRecord {
  time: string;
  level: LogLevel;
  context: string | null;
  message: string;
  [field: string]: unknown;
}

export function logFormatFromEnv(env: Record<string, string | undefined> = process.env): LogFormat {
  const raw = env['LOG_FORMAT']?.trim().toLowerCase();
  if (raw === 'json' || raw === 'pretty') return raw;
  return env['NODE_ENV'] === 'production' ? 'json' : 'pretty';
}

const LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];

/** Renders one record as a line; exported so the format is unit-tested. */
export function renderRecord(record: LogRecord, format: LogFormat): string {
  if (format === 'json') return JSON.stringify(record);
  const { time, level, context, message, ...rest } = record;
  const fields = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
  return `${time} ${level.toUpperCase().padEnd(7)} ${context === null ? '' : `[${context}] `}${message}${fields}`;
}

/**
 * The Nest logger. Nest passes `(message, ...optionalParams)` where the last
 * string is the context; an `Error` or a plain object among the params
 * becomes fields on the record (`err`, or the object's own keys).
 */
export class JsonLogger implements LoggerService {
  private enabled = new Set<LogLevel>(LEVELS);

  constructor(
    private readonly format: LogFormat = logFormatFromEnv(),
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly now: () => Date = () => new Date(),
  ) {}

  setLogLevels(levels: LogLevel[]): void {
    this.enabled = new Set(levels);
  }

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('fatal', message, params);
  }

  /** A record with named fields, for events code emits deliberately (`event: 'ingest.failed'`). */
  event(level: LogLevel, context: string, message: string, fields: Record<string, unknown>): void {
    if (!this.enabled.has(level)) return;
    this.write(
      renderRecord(
        { time: this.now().toISOString(), level, context, message, ...fields },
        this.format,
      ),
    );
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]): void {
    if (!this.enabled.has(level)) return;
    const rest = [...params];
    // Nest appends the context as the last string parameter.
    const context = typeof rest.at(-1) === 'string' ? (rest.pop() as string) : null;
    const fields: Record<string, unknown> = {};
    for (const param of rest) {
      if (param instanceof Error) {
        fields.err = { name: param.name, message: param.message, stack: param.stack };
      } else if (typeof param === 'object' && param !== null) {
        Object.assign(fields, param);
      } else if (param !== undefined) {
        fields.extra ??= [] as unknown[];
        (fields.extra as unknown[]).push(param);
      }
    }
    let text: string;
    if (message instanceof Error) {
      text = message.message;
      fields.err ??= { name: message.name, message: message.message, stack: message.stack };
    } else if (typeof message === 'string') {
      text = message;
    } else {
      text = JSON.stringify(message);
    }
    this.write(
      renderRecord(
        { time: this.now().toISOString(), level, context, message: text, ...fields },
        this.format,
      ),
    );
  }
}
