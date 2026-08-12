// アプリで起きた失敗を構造化して DB(error_logs)に残す。
//
// 目的は「後から Mac で解析できるようにする」こと。docker logs は 10MB×3 でローテートされ、
// 生テキストなので集計も差分確認もできない。取得は GET /api/errors + scripts/fetch-error-logs.sh。
//
// - console への出力はやめない(docker logs は最後の砦として維持する)
// - 記録に失敗してもアプリは止めない(ログ機構が本体を落とさない)
// - 秘匿情報(API キー・secret・LLM プロンプト全文)は detail に載せない
import crypto from "node:crypto";
import * as db from "./db.ts";

export type ErrorLevel = "error" | "warn";

export interface ErrorLogInput {
  // 発生源: generation / llm / api / scheduler / context / process。
  // iOS からの報告は ios-api / ios-player(origin = 'ios')
  source: string;
  // 安定した識別子(スネークケース)。後の解析で「新規か既知か」を分類するキーになるので、
  // 可変値(ID・曲名)は event ではなく message / detail に入れる
  event: string;
  message: string;
  detail?: Record<string, unknown>;
  taskId?: number | null;
  // iOS からの報告のみ指定する(既定はサーバー自身)
  origin?: "server" | "ios";
  occurredAt?: string;
}

const MESSAGE_MAX = 1000;
const DETAIL_MAX = 8000;
const STACK_MAX = 2000;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…(${value.length} 文字)` : value;
}

// SQLite 側の strftime('%Y-%m-%dT%H:%M:%fZ', 'now') と同じ形式
export function nowIso(): string {
  return new Date().toISOString();
}

// fingerprint 用の正規化。可変部分(URL・UUID・ID・曲名・数値)を伏せて
// 「同じ種類のエラー」が同じ値になるようにする(task 12 と task 13 の失敗を同一視する)。
// 二重引用符の中身は ID らしきもの(英数字 8 文字以上で数字を含む = request_id 等)だけを
// 伏せる — 中身を一律に伏せると API の "invalid x-api-key" と "rate limit" が
// 同じ fingerprint になり、解析で区別できなくなるため。
// 数値は一律 <n> にするので、HTTP 500 と 502 は同じ値になる(実際のコードは detail で見る)
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'）)]+/g, "<url>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/「[^」]{0,120}」/g, "<str>")
    .replace(/"[A-Za-z0-9_-]{8,}"/g, (quoted) => (/\d/.test(quoted) ? '"<id>"' : quoted))
    .replace(/\d+/g, "<n>")
    .trim();
}

export function fingerprintOf(source: string, event: string, message: string): string {
  return crypto
    .createHash("sha1")
    .update(`${source}\n${event}\n${normalizeMessage(message)}`)
    .digest("hex")
    .slice(0, 12);
}

// 例外を detail 用のオブジェクトにする(message は呼び出し側が組み立てる)
export function errorDetail(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack ? truncate(err.stack, STACK_MAX) : undefined,
    };
  }
  return { errorMessage: String(err) };
}

function serializeDetail(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  try {
    const json = JSON.stringify(detail);
    if (json === undefined) return null;
    // 切り詰めても JSON として読めるようにする(解析側は JSON.parse する)
    return json.length > DETAIL_MAX
      ? JSON.stringify({ truncated: true, preview: json.slice(0, DETAIL_MAX - 200) })
      : json;
  } catch (err) {
    return JSON.stringify({ serializeError: String(err) });
  }
}

function record(level: ErrorLevel, input: ErrorLogInput): void {
  const message = truncate(input.message, MESSAGE_MAX);
  const line = `[${input.source}] ${message}`;
  if (level === "error") console.error(line);
  else console.warn(line);

  try {
    db.insertErrorLog({
      occurredAt: input.occurredAt ?? nowIso(),
      level,
      origin: input.origin ?? "server",
      source: input.source,
      event: input.event,
      message,
      detail: serializeDetail(input.detail),
      fingerprint: fingerprintOf(input.source, input.event, message),
      taskId: input.taskId ?? null,
    });
  } catch (err) {
    // ここで投げると本来のエラー処理を壊す。console には出ているので観測はできる
    console.error(`[errorlog] エラーログの記録に失敗: ${err}`);
  }
}

export function logError(input: ErrorLogInput): void {
  record("error", input);
}

export function logWarn(input: ErrorLogInput): void {
  record("warn", input);
}
