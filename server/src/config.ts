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

export const DATA_DIR = path.join(REPO_ROOT, "data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
export const IMAGE_DIR = path.join(DATA_DIR, "images");
export const DB_PATH = path.join(DATA_DIR, "db.sqlite");
export const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public"
);

export const SUNO_API_KEY = process.env.SUNOAPI_ORG_KEY ?? "";
export const SUNO_BASE_URL = process.env.SUNOAPI_BASE_URL ?? "https://api.kie.ai";
export const SUNO_MODEL = process.env.SUNO_MODEL ?? "V5";

if (!SUNO_API_KEY) {
  console.error(
    "SUNOAPI_ORG_KEY が見つかりません。リポジトリ直下の .env か環境変数で設定してください。"
  );
  process.exit(1);
}

for (const dir of [DATA_DIR, AUDIO_DIR, IMAGE_DIR]) {
  mkdirSync(dir, { recursive: true });
}
