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
  favorite: number; // 0/1(★)
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
    favorite INTEGER NOT NULL DEFAULT 0,
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
addColumnIfMissing("tracks", "favorite", "favorite INTEGER NOT NULL DEFAULT 0");

export function createTask(input: {
  provider: string;
  providerTaskId: string;
  prompt: string;
  instrumental: boolean;
  model: string;
}): TaskRow {
  const result = db
    .prepare(
      `INSERT INTO tasks (provider, provider_task_id, prompt, instrumental, model, status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`
    )
    .run(
      input.provider,
      input.providerTaskId,
      input.prompt,
      input.instrumental ? 1 : 0,
      input.model
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

export function listTracks(limit = 200): TrackRow[] {
  return db
    .prepare(`SELECT * FROM tracks ORDER BY id DESC LIMIT ?`)
    .all(limit) as unknown as TrackRow[];
}

export function getTrack(id: number): TrackRow | undefined {
  return db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(id) as
    | TrackRow
    | undefined;
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

export function countPresets(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM presets`).get() as {
    n: number;
  };
  return row.n;
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

// 評価の部分更新。渡されたフィールドだけ書き換え、更新後の行を返す
export function updateTrackRating(
  id: number,
  input: { rating?: 1 | -1 | null; favorite?: boolean }
): TrackRow | undefined {
  if (!getTrack(id)) return undefined;
  if (input.rating !== undefined) {
    db.prepare(`UPDATE tracks SET rating = ? WHERE id = ?`).run(
      input.rating,
      id
    );
  }
  if (input.favorite !== undefined) {
    db.prepare(`UPDATE tracks SET favorite = ? WHERE id = ?`).run(
      input.favorite ? 1 : 0,
      id
    );
  }
  return getTrack(id);
}
