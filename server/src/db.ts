// メタデータ DB(node:sqlite)。tasks = 生成ジョブ、tracks = 完成した楽曲
import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./config.ts";

// 進行中はプロバイダのステータス(PENDING / TEXT_SUCCESS / FIRST_SUCCESS / SUCCESS)を
// そのまま保持し、音源の保存まで終えたら COMPLETE、失敗は FAILED にする
export const TERMINAL_STATUSES = ["COMPLETE", "FAILED"] as const;

export interface TaskRow {
  id: number;
  provider: string;
  provider_task_id: string;
  prompt: string;
  instrumental: number;
  model: string;
  status: string;
  error: string | null;
  mode: string; // 'manual' | 'daily' | 'daily_adventure'
  style: string | null; // LLM が生成したスタイルプロンプト(英語)
  style_ja: string | null; // スタイルプロンプトの日本語訳
  lyrics: string | null; // 英語歌詞
  lyrics_ja: string | null; // 日本語訳
  title: string | null; // LLM が付けた曲名
  intent: string | null; // 狙いの説明(日本語)
  llm_model: string | null; // 生成に使った LLM のモデル名
  llm_prompt: string | null; // LLM に送った入力全文(プリセット・直近スタイル等を含む)
  created_at: string;
  updated_at: string;
}

export interface TrackRow {
  id: number;
  task_id: number;
  provider_track_id: string;
  title: string;
  duration: number;
  audio_file: string;
  image_file: string | null;
  rating: number | null; // 1 = 👍, -1 = 👎, NULL = 未評価
  rated_at: string | null; // 最後に評価を変更した日時
  created_at: string;
}

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_task_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    instrumental INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    provider_track_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    audio_file TEXT NOT NULL,
    image_file TEXT,
    rating INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    label_ja TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (category, value)
  );
  -- 好みプロファイル文書(廃止済み。過去データの履歴としてテーブルは残す — 好みはプリセット評価集計に一本化)
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS real_world_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    word TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_real_world_words_created ON real_world_words(created_at);
  CREATE TABLE IF NOT EXISTS task_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    preset_id INTEGER,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    label_ja TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_presets_task ON task_presets(task_id);
`);

// 既存 DB への後方互換マイグレーション(カラムが無ければ追加)
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table) as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
addColumnIfMissing("tracks", "rating", "rating INTEGER");
addColumnIfMissing("tracks", "rated_at", "rated_at TEXT"); // 最後に評価を変更した日時

// ★(favorite)は廃止し 👍/👎 の 2 択に統一。旧 DB の ★ は 👍 に変換してカラムを削除
{
  const cols = db
    .prepare(`SELECT name FROM pragma_table_info('tracks')`)
    .all() as unknown as { name: string }[];
  if (cols.some((c) => c.name === "favorite")) {
    db.exec(`UPDATE tracks SET rating = 1 WHERE favorite = 1 AND rating IS NULL`);
    db.exec(`ALTER TABLE tracks DROP COLUMN favorite`);
  }
}
addColumnIfMissing("tasks", "mode", "mode TEXT NOT NULL DEFAULT 'manual'");
addColumnIfMissing("tasks", "style", "style TEXT");
addColumnIfMissing("tasks", "style_ja", "style_ja TEXT");
addColumnIfMissing("tasks", "lyrics", "lyrics TEXT");
addColumnIfMissing("tasks", "lyrics_ja", "lyrics_ja TEXT");
addColumnIfMissing("tasks", "title", "title TEXT");
addColumnIfMissing("tasks", "intent", "intent TEXT");
addColumnIfMissing("tasks", "llm_model", "llm_model TEXT");
addColumnIfMissing("tasks", "llm_prompt", "llm_prompt TEXT");

export function createTask(input: {
  provider: string;
  providerTaskId: string;
  prompt: string;
  instrumental: boolean;
  model: string;
  mode: string;
  style?: string | null;
  styleJa?: string | null;
  lyrics?: string | null;
  lyricsJa?: string | null;
  title?: string | null;
  intent?: string | null;
  llmModel?: string | null;
  llmPrompt?: string | null;
}): TaskRow {
  const result = db
    .prepare(
      `INSERT INTO tasks (provider, provider_task_id, prompt, instrumental, model, status,
                          mode, style, style_ja, lyrics, lyrics_ja, title, intent, llm_model, llm_prompt)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.provider,
      input.providerTaskId,
      input.prompt,
      input.instrumental ? 1 : 0,
      input.model,
      input.mode,
      input.style ?? null,
      input.styleJa ?? null,
      input.lyrics ?? null,
      input.lyricsJa ?? null,
      input.title ?? null,
      input.intent ?? null,
      input.llmModel ?? null,
      input.llmPrompt ?? null
    );
  return getTask(Number(result.lastInsertRowid))!;
}

export function getTask(id: number): TaskRow | undefined {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | TaskRow
    | undefined;
}

export function updateTaskStatus(
  id: number,
  status: string,
  error?: string
): void {
  db.prepare(
    `UPDATE tasks SET status = ?, error = ?,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  ).run(status, error ?? null, id);
}

export function listActiveTasks(): TaskRow[] {
  return db
    .prepare(
      `SELECT * FROM tasks WHERE status NOT IN ('COMPLETE', 'FAILED') ORDER BY id`
    )
    .all() as unknown as TaskRow[];
}

export function listTasks(limit = 50): TaskRow[] {
  return db
    .prepare(`SELECT * FROM tasks ORDER BY id DESC LIMIT ?`)
    .all(limit) as unknown as TaskRow[];
}

export function insertTrack(input: {
  taskId: number;
  providerTrackId: string;
  title: string;
  duration: number;
  audioFile: string;
  imageFile: string | null;
}): void {
  db.prepare(
    `INSERT OR IGNORE INTO tracks (task_id, provider_track_id, title, duration, audio_file, image_file)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.taskId,
    input.providerTrackId,
    input.title,
    input.duration,
    input.audioFile,
    input.imageFile
  );
}

// 楽曲一覧には生成時の情報(リクエスト・モデル・スタイル・歌詞・訳・狙い・LLM 入力)も添える
export type TrackWithTaskRow = TrackRow & {
  mode: string;
  prompt: string;
  instrumental: number;
  model: string;
  style: string | null;
  style_ja: string | null;
  lyrics: string | null;
  lyrics_ja: string | null;
  intent: string | null;
  llm_model: string | null;
  llm_prompt: string | null;
};

const TRACK_TASK_COLUMNS = `tracks.*, tasks.mode, tasks.prompt, tasks.instrumental, tasks.model,
  tasks.style, tasks.style_ja, tasks.lyrics, tasks.lyrics_ja, tasks.intent, tasks.llm_model, tasks.llm_prompt`;

export function listTracks(limit = 200): TrackWithTaskRow[] {
  return db
    .prepare(
      `SELECT ${TRACK_TASK_COLUMNS}
       FROM tracks JOIN tasks ON tasks.id = tracks.task_id
       ORDER BY tracks.id DESC LIMIT ?`
    )
    .all(limit) as unknown as TrackWithTaskRow[];
}

// 直近の生成スタイル(LLM の重複回避用)
export function listRecentStyles(limit = 5): string[] {
  const rows = db
    .prepare(
      `SELECT style FROM tasks WHERE style IS NOT NULL ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as unknown as { style: string }[];
  return rows.map((r) => r.style);
}

// 直近の生成スタイル(和訳付き。生成パラメータ表示用 — LLM への注入は英語のみの listRecentStyles)
export interface RecentStyleRow {
  style: string;
  styleJa: string | null;
}

export function listRecentStyleRows(limit = 5): RecentStyleRow[] {
  const rows = db
    .prepare(
      `SELECT style, style_ja FROM tasks WHERE style IS NOT NULL ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as unknown as { style: string; style_ja: string | null }[];
  return rows.map((r) => ({ style: r.style, styleJa: r.style_ja }));
}

// --- リアルワード(曲の中心となった語。使用回数を数えて重複生成を防ぐ) ---

export const WORD_LIMIT_DEFAULTS = {
  wordMaxUses: 2, // ウィンドウ内の同一ワード使用上限
  wordWindowDays: 30, // 集計ウィンドウ(日)。外れたワードは自動的に再利用可能になる
} as const;

export function getWordLimitSettings(): {
  wordMaxUses: number;
  wordWindowDays: number;
} {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    wordMaxUses: num(getSetting("word_max_uses"), WORD_LIMIT_DEFAULTS.wordMaxUses),
    wordWindowDays: num(
      getSetting("word_window_days"),
      WORD_LIMIT_DEFAULTS.wordWindowDays
    ),
  };
}

export function insertRealWorldWords(taskId: number, words: string[]): void {
  const stmt = db.prepare(
    `INSERT INTO real_world_words (task_id, word) VALUES (?, ?)`
  );
  for (const w of words) {
    const word = w.trim().toLowerCase();
    if (word) stmt.run(taskId, word);
  }
}

export function listRealWorldWords(taskId: number): string[] {
  const rows = db
    .prepare(`SELECT word FROM real_world_words WHERE task_id = ? ORDER BY id`)
    .all(taskId) as unknown as { word: string }[];
  return rows.map((r) => r.word);
}

// ウィンドウ内(直近 windowDays 日)のワードごとの使用回数。
// 比較の両辺を同じ ISO 形式(strftime)で揃えて文字列比較の齟齬を避ける
export interface WordUsage {
  word: string;
  uses: number;
  lastUsedAt: string;
}

export function countRealWorldWordUses(windowDays: number): WordUsage[] {
  return db
    .prepare(
      `SELECT word, COUNT(*) AS uses, MAX(created_at) AS lastUsedAt
       FROM real_world_words
       WHERE created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
       GROUP BY word ORDER BY uses DESC, word`
    )
    .all(`-${Math.floor(windowDays)} days`) as unknown as WordUsage[];
}

// --- 設定(key-value)---

export function getSetting(key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).run(key, value);
}

export function getTrack(id: number): TrackWithTaskRow | undefined {
  return db
    .prepare(
      `SELECT ${TRACK_TASK_COLUMNS}
       FROM tracks JOIN tasks ON tasks.id = tracks.task_id
       WHERE tracks.id = ?`
    )
    .get(id) as TrackWithTaskRow | undefined;
}

export interface PresetRow {
  id: number;
  category: string;
  value: string;
  label_ja: string;
  created_at: string;
}

export function listPresets(): PresetRow[] {
  return db
    .prepare(`SELECT * FROM presets ORDER BY category, id`)
    .all() as unknown as PresetRow[];
}

export function getPreset(id: number): PresetRow | undefined {
  return db.prepare(`SELECT * FROM presets WHERE id = ?`).get(id) as
    | PresetRow
    | undefined;
}

// (category, value) の UNIQUE 違反は SQLite の例外をそのまま投げる(API 層で 409 にする)
export function createPreset(input: {
  category: string;
  value: string;
  labelJa: string;
}): PresetRow {
  const result = db
    .prepare(`INSERT INTO presets (category, value, label_ja) VALUES (?, ?, ?)`)
    .run(input.category, input.value, input.labelJa);
  return getPreset(Number(result.lastInsertRowid))!;
}

export function updatePreset(
  id: number,
  input: { category?: string; value?: string; labelJa?: string }
): PresetRow | undefined {
  const current = getPreset(id);
  if (!current) return undefined;
  db.prepare(
    `UPDATE presets SET category = ?, value = ?, label_ja = ? WHERE id = ?`
  ).run(
    input.category ?? current.category,
    input.value ?? current.value,
    input.labelJa ?? current.label_ja,
    id
  );
  return getPreset(id);
}

export function deletePreset(id: number): boolean {
  return db.prepare(`DELETE FROM presets WHERE id = ?`).run(id).changes > 0;
}

// --- 使用プリセット(タスク単位の記録。評価集計の元データ) ---
// preset_id は集計用(プリセット削除後も行は残す)。category/value/label_ja は使用時点の
// スナップショットで、プリセットが編集・削除されても表示できる

export interface TaskPresetRow {
  category: string;
  value: string;
  label_ja: string;
}

export function insertTaskPresets(taskId: number, presets: PresetRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO task_presets (task_id, preset_id, category, value, label_ja)
     VALUES (?, ?, ?, ?, ?)`
  );
  // manual はユーザー選択と LLM 出力の和集合で渡るため、preset_id で重複除去する
  const seen = new Set<number>();
  for (const p of presets) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    stmt.run(taskId, p.id, p.category, p.value, p.label_ja);
  }
}

export function listTaskPresets(taskId: number): TaskPresetRow[] {
  return db
    .prepare(
      `SELECT category, value, label_ja FROM task_presets WHERE task_id = ? ORDER BY id`
    )
    .all(taskId) as unknown as TaskPresetRow[];
}

export interface PresetRatingCount {
  up: number;
  down: number;
}

// プリセット別の 👍/👎 集計(全期間)。保存値は持たず毎回算出する(評価変更が次の生成に即反映)。
// 参照側が現存プリセットの id で引くため、削除済みプリセットの行は自然に無視される
export function countPresetRatings(): Map<number, PresetRatingCount> {
  const rows = db
    .prepare(
      `SELECT tp.preset_id,
              SUM(CASE WHEN tr.rating = 1  THEN 1 ELSE 0 END) AS up,
              SUM(CASE WHEN tr.rating = -1 THEN 1 ELSE 0 END) AS down
       FROM task_presets tp JOIN tracks tr ON tr.task_id = tp.task_id
       WHERE tr.rating IS NOT NULL AND tp.preset_id IS NOT NULL
       GROUP BY tp.preset_id`
    )
    .all() as unknown as { preset_id: number; up: number; down: number }[];
  return new Map(rows.map((r) => [r.preset_id, { up: r.up, down: r.down }]));
}

// 評価の更新。更新後の行を返す
export function updateTrackRating(
  id: number,
  rating: 1 | -1 | null
): TrackWithTaskRow | undefined {
  if (!getTrack(id)) return undefined;
  db.prepare(
    `UPDATE tracks SET rating = ?, rated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
  ).run(rating, id);
  return getTrack(id);
}
