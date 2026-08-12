// 毎日の自動生成スケジューラ。1 分間隔で現在時刻(設定のタイムゾーン)をチェックし、
// 当日の実行時刻以降で設定曲数(daily_count)に達していなければ 1 曲ずつ順次生成する。
// 最終生成日とその日の生成済み数は settings(last_daily_date / last_daily_count)に記録し、
// サーバー停止中に実行時刻を跨いだ場合や途中失敗時も、残数だけ追い生成される
import { buildTodayContext } from "./context.ts";
import * as db from "./db.ts";
import { errorDetail, logError } from "./errorlog.ts";
import { acceptGeneration, completeGeneration } from "./generation.ts";
import { selectReferenceSong } from "./reference.ts";

const CHECK_INTERVAL_MS = 60_000;
// 失敗時の再試行間隔(毎分 LLM を叩き続けないため)
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

export interface DailySettings {
  dailyEnabled: boolean;
  dailyHour: number; // 0〜23(dailyTimezone での実行時刻)
  dailyTimezone: string; // IANA タイムゾーン
  dailyCount: number; // 1 日に生成する曲数
  lastDailyDate: string | null; // 最後に自動生成した日付(dailyTimezone での YYYY-MM-DD)
}

export const SETTING_DEFAULTS = {
  dailyEnabled: true,
  dailyHour: 6,
  dailyTimezone: "America/Los_Angeles",
  dailyCount: 3,
} as const;

export function getDailySettings(): DailySettings {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : fallback;
  };
  return {
    dailyEnabled:
      (db.getSetting("daily_enabled") ?? String(SETTING_DEFAULTS.dailyEnabled)) === "true",
    dailyHour: num(db.getSetting("daily_hour"), SETTING_DEFAULTS.dailyHour),
    dailyTimezone: db.getSetting("daily_timezone") ?? SETTING_DEFAULTS.dailyTimezone,
    dailyCount: num(db.getSetting("daily_count"), SETTING_DEFAULTS.dailyCount),
    lastDailyDate: db.getSetting("last_daily_date") ?? null,
  };
}

// last_daily_date の日に生成済みの曲数。記録なし(1 日 1 曲時代の旧データ)は
// その日を全数生成済み扱いにして、デプロイ当日の意図しない追い生成を防ぐ
function getLastDailyCount(): number | null {
  const v = db.getSetting("last_daily_count");
  const n = Number(v);
  return v !== undefined && Number.isFinite(n) ? n : null;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// 指定タイムゾーンでの日付(YYYY-MM-DD)と時(0〜23)を返す
export function localDateAndHour(
  now: Date,
  timezone: string
): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

// 時刻判定ロジック(テスト用に純粋関数として切り出し)。
// 当日(タイムゾーン基準)の実行時刻以降で、その日の生成が dailyCount 曲に達していなければ
// 残数(remaining)分を run。lastDailyCount が null(旧データ・記録なし)の日は全数生成済み扱い
export function shouldRunDaily(input: {
  now: Date;
  timezone: string;
  hour: number;
  lastDailyDate: string | null;
  lastDailyCount: number | null;
  dailyCount: number;
}): { run: boolean; remaining: number; localDate: string } {
  const local = localDateAndHour(input.now, input.timezone);
  const generatedToday =
    input.lastDailyDate === local.date
      ? (input.lastDailyCount ?? input.dailyCount)
      : 0;
  const remaining = Math.max(0, input.dailyCount - generatedToday);
  return {
    run: local.hour >= input.hour && remaining > 0,
    remaining,
    localDate: local.date,
  };
}

// 毎日の自動生成 1 回分の受付結果。complete() が LLM 生成 → Suno 送信の本体で、
// スケジューラは await し、HTTP のトリガ(POST /api/daily/run)は投げっぱなしにする
export interface DailyRunStart {
  task: db.TaskRow;
  complete: () => Promise<db.TaskRow>;
}

// 参照曲の候補が 1 件も無い(アーティスト未登録)。呼び出し側が 409 と再試行の判断に使う
export class NoReferenceSongError extends Error {
  constructor() {
    super("参照曲が登録されていないため生成できません。アーティストを登録してください");
    this.name = "NoReferenceSongError";
  }
}

// 毎日の自動生成の受付: 参照曲の選択 → コンテキスト取得 → タスク行の作成。
// 登録済みの曲から 1 曲を参照曲に選び、その曲に似た新曲を作らせる(曲調は参照曲、
// 歌詞のテーマは今日のコンテキストから)。登録が 0 件なら生成しない(NoReferenceSongError)
export async function startDailyRun(): Promise<DailyRunStart> {
  // 1. 参照曲の選択(サーバーが選ぶ。LRU + ランダムなので同じ日の 2 曲目は別アーティストになる)
  const reference = selectReferenceSong();
  if (!reference) throw new NoReferenceSongError();
  console.log(
    `[daily] 参照曲: ${reference.artistName}「${reference.title}」` +
      `(最終使用 ${reference.lastUsedAt ?? "なし"})`
  );

  // 2. 外部コンテキスト(ニュース)取得。失敗しても生成は続行(その場合セクション無し)
  const extraContext = await buildTodayContext();
  if (extraContext) {
    console.log(`[daily] 今日のコンテキストを注入(${extraContext.length} 文字)`);
  }

  const task = acceptGeneration({
    prompt: `毎日の自動生成 / ${reference.artistName}「${reference.title}」風`,
    instrumental: false,
    mode: "daily",
    artist: {
      artistId: reference.artistId,
      artistSongId: reference.id,
      artistName: reference.artistName,
      songTitle: reference.title,
    },
  });

  return {
    task,
    complete: () =>
      completeGeneration(task.id, {
        instrumental: false,
        planInput: {
          instrumental: false,
          freeText: "",
          extraContext: extraContext ?? undefined,
          referenceSong: {
            artist: reference.artistName,
            title: reference.title,
            album: reference.album,
            releaseYear: reference.releaseYear,
            genre: reference.genre,
          },
        },
      }),
  };
}

// 受付から完了まで待つ(スケジューラ用)。サーバー内で動き HTTP を経由しないため
// プロキシのタイムアウト制約が無く、順次生成と last_daily_count の記録の正しさもこれで保たれる
export async function runDaily(): Promise<{ task: db.TaskRow }> {
  const started = await startDailyRun();
  return { task: await started.complete() };
}

let ticking = false;
let lastFailedAt = 0;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  // 失敗ログに「いつの分の生成か」を残すために try の外で持つ
  let localDateForLog: string | null = null;
  try {
    const settings = getDailySettings();
    if (!settings.dailyEnabled) return;
    const { run, remaining, localDate } = shouldRunDaily({
      now: new Date(),
      timezone: settings.dailyTimezone,
      hour: settings.dailyHour,
      lastDailyDate: settings.lastDailyDate,
      lastDailyCount: getLastDailyCount(),
      dailyCount: settings.dailyCount,
    });
    localDateForLog = localDate;
    if (!run) return;
    // 初回起動(記録なし)は当日分を生成済み扱いにする。導入直後の意図しない生成を避け、
    // 翌日の実行時刻から通常運転に入る
    if (settings.lastDailyDate === null) {
      db.setSetting("last_daily_date", localDate);
      db.setSetting("last_daily_count", String(settings.dailyCount));
      console.log(`[daily] 初回起動のため ${localDate} を生成済み扱いにしました`);
      return;
    }
    if (Date.now() - lastFailedAt < RETRY_AFTER_FAILURE_MS) return;
    // 残数分を 1 曲ずつ順次生成する。順次なので 2 曲目以降のプロンプトには同日の前の曲の
    // スタイル・リアルワードが既存の仕組みで注入され、曲間の重複を避けられる。
    // 成功のたびに生成済み数を記録し、途中失敗・再起動時は 30 分後の再試行で残数だけ追い生成する
    const generatedToday = settings.dailyCount - remaining;
    console.log(
      `[daily] ${localDate} の自動生成を開始(${generatedToday + 1}〜${settings.dailyCount} 曲目)`
    );
    for (let i = 0; i < remaining; i++) {
      const result = await runDaily();
      db.setSetting("last_daily_date", localDate);
      db.setSetting("last_daily_count", String(generatedToday + i + 1));
      console.log(
        `[daily] ${localDate} の ${generatedToday + i + 1}/${settings.dailyCount} 曲目を生成 (task ${result.task.id})`
      );
    }
    console.log(`[daily] ${localDate} の自動生成完了`);
  } catch (err) {
    // 参照曲が 0 件のときもここに来る。last_daily_* を進めないので、アーティストを
    // 登録すればその日のうちに追い生成される
    lastFailedAt = Date.now();
    // 参照曲 0 件(= アーティスト未登録の設定漏れ)は原因も対処も違うので event を分ける
    const noReference = err instanceof NoReferenceSongError;
    logError({
      source: "scheduler",
      event: noReference ? "no_reference_song" : "daily_failed",
      message: `自動生成に失敗(30 分後に再試行): ${err}`,
      detail: {
        localDate: localDateForLog,
        artistCount: noReference ? db.listArtists().length : undefined,
        ...errorDetail(err),
      },
    });
  } finally {
    ticking = false;
  }
}

// サーバ起動時に呼ぶ。起動直後のチェックで停止中に跨いだ分も追い生成される
export function startScheduler(): void {
  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
}
