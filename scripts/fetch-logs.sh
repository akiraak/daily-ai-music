#!/usr/bin/env bash
# サーバーからログと運用データを取得して .logs/ に保存する(`/logs` = Claude Code での解析用)。
# エラーログだけでなく、アプリ改善の分析に使えるデータ(タスク・楽曲・生成パラメータ・設定・
# クレジット残)も全部取る。
#
#   ./scripts/fetch-logs.sh                 # 本番(music.chobi.me)。エラーは直近 24 時間
#   ./scripts/fetch-logs.sh --since 90d     # エラーの期間指定(30m / 12h / 7d または ISO8601)
#   ./scripts/fetch-logs.sh --local         # ローカルサーバー(localhost:3014)
#   ./scripts/fetch-logs.sh --level error   # エラーを error のみに(既定は warn も含む)
#   ./scripts/fetch-logs.sh --raw           # docker logs の生ログも取る(起動失敗・クラッシュ用)
#
# 出力: .logs/<env>-<日時>/ に errors.jsonl / tasks.jsonl / tracks.jsonl /
#       generation-params.json / settings.json / credits.json(+ --raw で docker.log)
#
# 本番は Cloudflare Access(Google ログイン)が /admin に掛かっていて curl で通れないため、
# X-API-Secret を付けて /api/* を叩く。secret は g3plus-ops 側の .env(本番の正本)から読む。
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_NAME="prod"
BASE_URL="https://music.chobi.me"
API_PREFIX="/api"
ENV_FILE="${ERROR_LOG_ENV_FILE:-$HOME/Projects/g3plus-ops/daily-ai-music/.env}"
SSH_HOST="${G3PLUS_SSH_HOST:-ubuntu@g3plus.lan}"
SSH_KEY="${G3PLUS_SSH_KEY:-$HOME/.ssh/id_rsa_nopass}"
CONTAINER="daily-ai-music"
SINCE="24h"
LIMIT="1000"
LEVEL=""
ORIGIN=""
SOURCE=""
OUT_DIR=""
RAW=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --local)
      ENV_NAME="local"
      BASE_URL="http://localhost:${PORT:-3014}"
      # ローカルは管理画面と同じアプリ層無認証の経路を使う(secret 不要)
      API_PREFIX="/admin/api"
      ENV_FILE=""
      shift
      ;;
    --url) BASE_URL="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --level) LEVEL="$2"; shift 2 ;;
    --origin) ORIGIN="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --out) OUT_DIR="$2"; shift 2 ;;
    --raw) RAW=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "不明な引数: $1" >&2; usage >&2; exit 1 ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M)"
OUT_DIR="${OUT_DIR:-.logs/${ENV_NAME}-${STAMP}}"
mkdir -p "$OUT_DIR"

SECRET=""
if [ -n "$ENV_FILE" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "本番の .env が見つかりません: $ENV_FILE" >&2
    echo "(別の場所にある場合は ERROR_LOG_ENV_FILE で指定するか、--local を使ってください)" >&2
    exit 1
  fi
  SECRET="$(grep -E '^API_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"'"'"'\r' | xargs)"
  if [ -z "$SECRET" ]; then
    echo "$ENV_FILE に API_SECRET がありません" >&2
    exit 1
  fi
fi

# 1 エンドポイント分を取得してファイルに保存する。失敗しても全体は止めない
# (credits はプロバイダ API を経由するので単独で落ちることがある)
fetch() {
  local path="$1" out="$2"
  local url="${BASE_URL}${API_PREFIX}${path}"
  if [ -n "$SECRET" ]; then
    curl -fsS -H "X-API-Secret: ${SECRET}" "$url" -o "$out" \
      || { echo "警告: ${path} の取得に失敗(スキップ)" >&2; rm -f "$out"; }
  else
    curl -fsS "$url" -o "$out" \
      || { echo "警告: ${path} の取得に失敗(スキップ)" >&2; rm -f "$out"; }
  fi
}

ERRORS_QUERY="/errors?since=${SINCE}&limit=${LIMIT}"
[ -n "$LEVEL" ] && ERRORS_QUERY="${ERRORS_QUERY}&level=${LEVEL}"
[ -n "$ORIGIN" ] && ERRORS_QUERY="${ERRORS_QUERY}&origin=${ORIGIN}"
[ -n "$SOURCE" ] && ERRORS_QUERY="${ERRORS_QUERY}&source=${SOURCE}"

echo "取得: ${BASE_URL}${API_PREFIX} (${ENV_NAME}) → ${OUT_DIR}/"
fetch "$ERRORS_QUERY" "$OUT_DIR/raw-errors.json"
fetch "/tasks" "$OUT_DIR/raw-tasks.json"
fetch "/tracks" "$OUT_DIR/raw-tracks.json"
fetch "/generation-params" "$OUT_DIR/generation-params.json"
fetch "/settings" "$OUT_DIR/settings.json"
fetch "/credits" "$OUT_DIR/credits.json"

# JSONL への整形とサマリ出力(最初に読む 1 画面)
node -e '
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[1];

const load = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { return null; }
};
const writeJsonl = (name, rows) => {
  fs.writeFileSync(
    path.join(dir, name),
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "")
  );
};
const pretty = (name) => {
  const obj = load(name);
  if (obj !== null) fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2) + "\n");
  return obj;
};

// --- errors: JSONL + fingerprint ごとの件数サマリ ---
const errRaw = load("raw-errors.json");
if (errRaw) {
  const { errors = [], since } = errRaw;
  writeJsonl("errors.jsonl", errors);
  fs.unlinkSync(path.join(dir, "raw-errors.json"));
  const total = errors.reduce((n, e) => n + (e.repeatCount || 1), 0);
  console.log(`\nerrors.jsonl: ${errors.length} 行 / 発生 ${total} 件(since ${since})`);
  const groups = new Map();
  for (const e of errors) {
    const g = groups.get(e.fingerprint) ?? { count: 0, last: "", e };
    g.count += e.repeatCount || 1;
    if (e.lastSeenAt > g.last) g.last = e.lastSeenAt;
    groups.set(e.fingerprint, g);
  }
  for (const [fp, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    const e = g.e;
    const head = `${String(g.count).padStart(3)}x ${e.level.padEnd(5)} ${e.origin}/${e.source}/${e.event}`;
    console.log(`${head}  [${fp}] 最終 ${g.last.slice(0, 16).replace("T", " ")}`);
    console.log(`     ${e.message.split("\n")[0].slice(0, 140)}`);
  }
}

// --- tasks: JSONL + 状態・モード別の集計と直近の失敗 ---
const taskRaw = load("raw-tasks.json");
if (taskRaw) {
  const tasks = taskRaw.tasks ?? [];
  writeJsonl("tasks.jsonl", tasks);
  fs.unlinkSync(path.join(dir, "raw-tasks.json"));
  const by = (key) => {
    const m = new Map();
    for (const t of tasks) m.set(t[key] ?? "?", (m.get(t[key] ?? "?") ?? 0) + 1);
    return [...m].map(([k, n]) => `${k} ${n}`).join(" / ");
  };
  console.log(`\ntasks.jsonl: ${tasks.length} 件(API は直近 50 件まで)  状態: ${by("status")}  モード: ${by("mode")}`);
  for (const t of tasks.filter((t) => t.status === "FAILED").slice(0, 5)) {
    const err = String(t.error ?? "").split("\n")[0].slice(0, 110);
    console.log(`  失敗 task ${t.id} [${t.mode ?? "?"}] ${t.createdAt ?? ""}: ${err}`);
  }
}

// --- tracks: JSONL + 件数 ---
const trackRaw = load("raw-tracks.json");
if (trackRaw) {
  const tracks = trackRaw.tracks ?? [];
  writeJsonl("tracks.jsonl", tracks);
  fs.unlinkSync(path.join(dir, "raw-tracks.json"));
  const published = tracks.filter((t) => t.published).length;
  console.log(`\ntracks.jsonl: ${tracks.length} 曲(公開 ${published}。API は直近 200 曲まで)`);
}

// --- そのまま保存する系: 整形して 1 行ずつ様子を出す ---
const params = pretty("generation-params.json");
if (params) console.log(`generation-params.json: ${Object.keys(params).join(", ")}`);
const settings = pretty("settings.json");
if (settings) {
  const s = settings.settings ?? settings;
  const shown = Object.entries(s).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`settings.json: ${shown}`);
}
const credits = pretty("credits.json");
if (credits) console.log(`credits.json: ${JSON.stringify(credits)}`);
' "$OUT_DIR"

if [ "$RAW" = "1" ]; then
  if [ "$ENV_NAME" = "local" ]; then
    echo "--raw は本番専用です(ローカルは ./run-server.sh の標準出力を見てください)" >&2
    exit 1
  fi
  # docker の --since は Go の duration(d は不可)なので日数は時間に直す
  DOCKER_SINCE="$SINCE"
  case "$SINCE" in
    *d) DOCKER_SINCE="$(( ${SINCE%d} * 24 ))h" ;;
  esac
  RAW_OUT="$OUT_DIR/docker.log"
  echo ""
  echo "生ログ: ssh ${SSH_HOST} docker logs ${CONTAINER} --since ${DOCKER_SINCE}"
  ssh -i "$SSH_KEY" "$SSH_HOST" \
    "docker logs ${CONTAINER} --since ${DOCKER_SINCE} 2>&1" > "$RAW_OUT"
  echo "$(wc -l < "$RAW_OUT" | xargs) 行 → ${RAW_OUT}"
fi
