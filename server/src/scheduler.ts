// 毎日の自動生成スケジューラ。1 分間隔で現在時刻(設定のタイムゾーン)をチェックし、
// 当日の実行時刻以降でまだ生成していなければ実行する。最終生成日は settings に記録し、
// サーバー停止中に実行時刻を跨いだ場合も起動時のチェックで追い生成される
import * as db from "./db.ts";
import { startGeneration } from "./generation.ts";
import { generateSongPlan, updateProfile } from "./llm.ts";

const CHECK_INTERVAL_MS = 60_000;
// 失敗時の再試行間隔(毎分 LLM を叩き続けないため)
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

export interface DailySettings {
  dailyEnabled: boolean;
  adventureProbability: number; // 0〜1
  dailyHour: number; // 0〜23(dailyTimezone での実行時刻)
  dailyTimezone: string; // IANA タイムゾーン
  lastDailyDate: string | null; // 最後に自動生成した日付(dailyTimezone での YYYY-MM-DD)
}

export const SETTING_DEFAULTS = {
  dailyEnabled: true,
  adventureProbability: 0.2,
  dailyHour: 6,
  dailyTimezone: "America/Los_Angeles",
} as const;

export function getDailySettings(): DailySettings {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) ? n : fallback;
  };
  return {
    dailyEnabled:
      (db.getSetting("daily_enabled") ?? String(SETTING_DEFAULTS.dailyEnabled)) === "true",
    adventureProbability: num(
      db.getSetting("adventure_probability"),
      SETTING_DEFAULTS.adventureProbability
    ),
    dailyHour: num(db.getSetting("daily_hour"), SETTING_DEFAULTS.dailyHour),
    dailyTimezone: db.getSetting("daily_timezone") ?? SETTING_DEFAULTS.dailyTimezone,
    lastDailyDate: db.getSetting("last_daily_date") ?? null,
  };
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
// 当日(タイムゾーン基準)の実行時刻以降で、まだその日の生成をしていなければ run
export function shouldRunDaily(input: {
  now: Date;
  timezone: string;
  hour: number;
  lastDailyDate: string | null;
}): { run: boolean; localDate: string } {
  const local = localDateAndHour(input.now, input.timezone);
  return {
    run: local.hour >= input.hour && input.lastDailyDate !== local.date,
    localDate: local.date,
  };
}

// 毎日の自動生成 1 回分: プロファイル更新 → 冒険日判定 → LLM 生成 → Suno 送信
export async function runDaily(): Promise<{
  task: db.TaskRow;
  adventure: boolean;
  profileUpdated: boolean;
}> {
  // 1. プロファイル更新(前回のプロファイル更新以降に評価が変わった曲があれば)
  const latestProfile = db.getLatestProfile();
  const rated = db.listRatedTracks(latestProfile?.created_at);
  let profileUpdated = false;
  if (rated.length > 0) {
    console.log(`[daily] 新しい評価 ${rated.length} 件でプロファイルを更新`);
    const content = await updateProfile({
      currentProfile: latestProfile?.content ?? null,
      ratedTracks: rated.map((t) => ({
        title: t.title,
        style: t.style,
        rating: t.rating,
      })),
    });
    db.insertProfile(content);
    profileUpdated = true;
  }

  // 2. 冒険日判定
  const settings = getDailySettings();
  const adventure = Math.random() < settings.adventureProbability;
  const mode = adventure ? "daily_adventure" : "daily";
  console.log(`[daily] mode=${mode} (冒険確率 ${settings.adventureProbability})`);

  // 3〜4. LLM 生成 → Suno 送信
  const { plan, llmModel, llmPrompt } = await generateSongPlan({
    mode,
    instrumental: false,
    profile: db.getLatestProfile()?.content ?? null,
    selectedPresets: [],
    presetPool: db.listPresets(),
    freeText: "",
    recentStyles: db.listRecentStyles(),
  });
  const task = await startGeneration({
    prompt: adventure ? "毎日の自動生成(冒険日)" : "毎日の自動生成",
    instrumental: false,
    mode,
    plan,
    llmModel,
    llmPrompt,
  });
  return { task, adventure, profileUpdated };
}

let ticking = false;
let lastFailedAt = 0;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const settings = getDailySettings();
    if (!settings.dailyEnabled) return;
    const { run, localDate } = shouldRunDaily({
      now: new Date(),
      timezone: settings.dailyTimezone,
      hour: settings.dailyHour,
      lastDailyDate: settings.lastDailyDate,
    });
    if (!run) return;
    // 初回起動(記録なし)は当日分を生成済み扱いにする。導入直後の意図しない生成を避け、
    // 翌日の実行時刻から通常運転に入る
    if (settings.lastDailyDate === null) {
      db.setSetting("last_daily_date", localDate);
      console.log(`[daily] 初回起動のため ${localDate} を生成済み扱いにしました`);
      return;
    }
    if (Date.now() - lastFailedAt < RETRY_AFTER_FAILURE_MS) return;
    console.log(`[daily] ${localDate} の自動生成を開始`);
    const result = await runDaily();
    db.setSetting("last_daily_date", localDate);
    console.log(
      `[daily] ${localDate} の自動生成完了 (task ${result.task.id}, adventure=${result.adventure})`
    );
  } catch (err) {
    lastFailedAt = Date.now();
    console.error(`[daily] 自動生成に失敗(30 分後に再試行): ${err}`);
  } finally {
    ticking = false;
  }
}

// サーバ起動時に呼ぶ。起動直後のチェックで停止中に跨いだ分も追い生成される
export function startScheduler(): void {
  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
}
