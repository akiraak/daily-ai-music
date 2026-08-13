// 設定と .env 読み込み。リポジトリ直下の .env(検証スクリプトと共通)を再利用する
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

function loadEnv(): void {
  let text: string;
  try {
    text = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  } catch {
    return; // .env が無ければ環境変数のみ
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

export const PORT = Number(process.env.PORT ?? 3014);

// 公開ページの絶対 URL のベース(OGP の og:url / og:image 用)。Host ヘッダからの推定は
// エッジ経由のスキーム判定(x-forwarded-proto)に依存して不確実なので採らない。
// 本番は ops 側 .env で PUBLIC_BASE_URL=https://music.chobi.me を設定する
export const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`
).replace(/\/+$/, "");

export const DATA_DIR = path.join(REPO_ROOT, "data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
export const IMAGE_DIR = path.join(DATA_DIR, "images");
// DB_PATH 環境変数は隔離 DB でのテスト用(通常運用では未設定のまま)
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "db.sqlite");
export const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public"
);
// 公開ページ(無認証。/ にマウント)。管理画面(public/)とは分けて置く
export const SITE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../site"
);

export const SUNO_API_KEY = process.env.SUNOAPI_ORG_KEY ?? "";
export const SUNO_BASE_URL = process.env.SUNOAPI_BASE_URL ?? "https://api.kie.ai";
// V5_5 は漢字の読み精度が V5 より高い(2026-08-11 に日本語歌唱を既定にしたため引き上げた)。
// 料金は V5 と同額。kie.ai の許容値は V4 / V4_5 / V4_5PLUS / V4_5ALL / V5 / V5_5
export const SUNO_MODEL = process.env.SUNO_MODEL ?? "V5_5";

export const API_SECRET = process.env.API_SECRET ?? "";

// LLM 生成パイプライン(スタイル・歌詞の生成)
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
export const LLM_MODEL = process.env.LLM_MODEL ?? "claude-sonnet-5";

if (!SUNO_API_KEY) {
  console.error(
    "SUNOAPI_ORG_KEY が見つかりません。リポジトリ直下の .env か環境変数で設定してください。"
  );
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY が見つかりません。リポジトリ直下の .env か環境変数で設定してください。"
  );
  process.exit(1);
}

// 公開運用時に意図せず無防備にならないよう fail-fast(ローカル開発でも .env に API_SECRET が必須)
if (API_SECRET.length < 16 || !/^[A-Za-z0-9_-]+$/.test(API_SECRET)) {
  console.error(
    "API_SECRET が必要です(16 文字以上、[A-Za-z0-9_-] のみ。例: openssl rand -hex 16)。リポジトリ直下の .env で設定してください。"
  );
  process.exit(1);
}

for (const dir of [DATA_DIR, AUDIO_DIR, IMAGE_DIR]) {
  mkdirSync(dir, { recursive: true });
}
