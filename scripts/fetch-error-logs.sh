#!/usr/bin/env bash
# サーバーの error_logs を取得して .logs/ に JSONL で保存する(Claude Code で解析するため)。
#
#   ./scripts/fetch-error-logs.sh                 # 本番(music.chobi.me)の直近 24 時間
#   ./scripts/fetch-error-logs.sh --since 7d      # 期間指定(30m / 12h / 7d または ISO8601)
#   ./scripts/fetch-error-logs.sh --local         # ローカルサーバー(localhost:3014)
#   ./scripts/fetch-error-logs.sh --level error   # error のみ(既定は warn も含む)
#   ./scripts/fetch-error-logs.sh --raw           # docker logs の生ログも取る(起動失敗・クラッシュ用)
#
# 本番は Cloudflare Access(Google ログイン)が /admin に掛かっていて curl で通れないため、
# X-API-Secret を付けて /api/errors を叩く。secret は g3plus-ops 側の .env(本番の正本)から読む。
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_NAME="prod"
BASE_URL="https://music.chobi.me"
API_PATH="/api/errors"
ENV_FILE="${ERROR_LOG_ENV_FILE:-$HOME/Projects/g3plus-ops/daily-ai-music/.env}"
SSH_HOST="${G3PLUS_SSH_HOST:-ubuntu@g3plus.lan}"
SSH_KEY="${G3PLUS_SSH_KEY:-$HOME/.ssh/id_rsa_nopass}"
CONTAINER="daily-ai-music"
SINCE="24h"
LIMIT="1000"
LEVEL=""
ORIGIN=""
SOURCE=""
OUT=""
RAW=0

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --local)
      ENV_NAME="local"
      BASE_URL="http://localhost:${PORT:-3014}"
      # ローカルは管理画面と同じアプリ層無認証の経路を使う(secret 不要)
      API_PATH="/admin/api/errors"
      ENV_FILE=""
      shift
      ;;
    --url) BASE_URL="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --level) LEVEL="$2"; shift 2 ;;
    --origin) ORIGIN="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --raw) RAW=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "不明な引数: $1" >&2; usage >&2; exit 1 ;;
  esac
done

mkdir -p .logs
STAMP="$(date +%Y%m%d-%H%M)"
OUT="${OUT:-.logs/errors-${ENV_NAME}-${STAMP}.jsonl}"

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

URL="${BASE_URL}${API_PATH}?since=${SINCE}&limit=${LIMIT}"
[ -n "$LEVEL" ] && URL="${URL}&level=${LEVEL}"
[ -n "$ORIGIN" ] && URL="${URL}&origin=${ORIGIN}"
[ -n "$SOURCE" ] && URL="${URL}&source=${SOURCE}"

echo "取得: ${BASE_URL}${API_PATH} (since=${SINCE})"
if [ -n "$SECRET" ]; then
  RESPONSE="$(curl -fsS -H "X-API-Secret: ${SECRET}" "$URL")"
else
  RESPONSE="$(curl -fsS "$URL")"
fi

# JSONL に整形して保存し、fingerprint ごとの件数サマリを出す(最初に読む 1 画面)
printf '%s' "$RESPONSE" | node -e '
const fs = require("node:fs");
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  const out = process.argv[1];
  const { errors = [], since } = JSON.parse(raw);
  fs.writeFileSync(out, errors.map((e) => JSON.stringify(e)).join("\n") + (errors.length ? "\n" : ""));
  const total = errors.reduce((n, e) => n + (e.repeatCount || 1), 0);
  console.log(`${errors.length} 行 / 発生 ${total} 件(since ${since}) → ${out}`);
  if (errors.length === 0) return;
  const groups = new Map();
  for (const e of errors) {
    const g = groups.get(e.fingerprint) ?? { count: 0, last: "", e };
    g.count += e.repeatCount || 1;
    if (e.lastSeenAt > g.last) g.last = e.lastSeenAt;
    groups.set(e.fingerprint, g);
  }
  console.log("");
  for (const [fp, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    const e = g.e;
    const head = `${String(g.count).padStart(3)}x ${e.level.padEnd(5)} ${e.origin}/${e.source}/${e.event}`;
    console.log(`${head}  [${fp}] 最終 ${g.last.slice(0, 16).replace("T", " ")}`);
    console.log(`     ${e.message.split("\n")[0].slice(0, 140)}`);
  }
});
' "$OUT"

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
  RAW_OUT=".logs/docker-${STAMP}.log"
  echo ""
  echo "生ログ: ssh ${SSH_HOST} docker logs ${CONTAINER} --since ${DOCKER_SINCE}"
  ssh -i "$SSH_KEY" "$SSH_HOST" \
    "docker logs ${CONTAINER} --since ${DOCKER_SINCE} 2>&1" > "$RAW_OUT"
  echo "$(wc -l < "$RAW_OUT" | xargs) 行 → ${RAW_OUT}"
fi
