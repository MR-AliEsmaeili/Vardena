import { Inject, Injectable, type LoggerService } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { getCorrelationId } from '../correlation/request-context.js';
import { redact } from './redaction.js';

/**
 * Production JSON-lines logger (one JSON object per line on stdout).
 *
 * Record shape:
 *   { timestamp, level, message, context?, correlationId?, trace?, ...meta }
 *
 * - `correlationId` is attached automatically from the request context.
 * - `meta` is spread top-level (queryable) after `redact()`; reserved keys
 *   in meta are dropped so callers cannot corrupt the envelope.
 * - Everything goes to stdout; the `level` field distinguishes severity.
 *   Fatal startup errors (before DI exists) are logged by `runEntrypoint`.
 */

type OutputLevel = 'debug' | 'verbose' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<OutputLevel | 'log', number> = {
  debug: 0,
  verbose: 0,
  log: 1,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const RESERVED_KEYS = [
  'timestamp',
  'level',
  'message',
  'context',
  'correlationId',
  'trace',
];

interface ParsedParams {
  meta: Record<string, unknown>;
  context?: string;
  trace?: string;
}

/**
 * Parses Nest's `(...optionalParams)` conventions:
 * trailing string = context; for error(), first leading string = stack trace;
 * plain objects merge into meta; Error instances land in meta.error.
 */
function parseParams(params: unknown[], expectTrace: boolean): ParsedParams {
  const meta: Record<string, unknown> = {};
  const extras: unknown[] = [];
  const rest = [...params];
  let context: string | undefined;
  if (rest.length > 0 && typeof rest[rest.length - 1] === 'string') {
    context = rest.pop() as string;
  }
  let trace: string | undefined;
  for (const param of rest) {
    if (expectTrace && trace === undefined && typeof param === 'string') {
      trace = param;
    } else if (param instanceof Error) {
      meta['error'] = param;
    } else if (param !== null && typeof param === 'object') {
      Object.assign(meta, param);
    } else if (param !== undefined) {
      extras.push(param);
    }
  }
  if (extras.length > 0) meta['extra'] = extras;
  const parsed: ParsedParams = { meta };
  if (context !== undefined) parsed.context = context;
  if (trace !== undefined) parsed.trace = trace;
  return parsed;
}

function toMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return `${message.name}: ${message.message}`;
  const json = JSON.stringify(redact(message));
  return typeof json === 'string' ? json : String(message);
}

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly minLevel: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.minLevel = LEVEL_ORDER[config.logLevel];
  }

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params, false);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params, false);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params, false);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params, false);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params, true);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params, true);
  }

  private write(
    level: OutputLevel,
    message: unknown,
    params: unknown[],
    expectTrace: boolean,
  ): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const { context, trace, meta } = parseParams(params, expectTrace);
    const correlationId = getCorrelationId();
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: toMessage(message),
    };
    if (context !== undefined) record['context'] = context;
    if (correlationId !== undefined) record['correlationId'] = correlationId;
    if (trace !== undefined) record['trace'] = trace;
    const safeMeta = redact(meta) as Record<string, unknown>;
    for (const reserved of RESERVED_KEYS) delete safeMeta[reserved];
    Object.assign(record, safeMeta);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
}
