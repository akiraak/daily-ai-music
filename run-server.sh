#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ポートの決定: PORT 環境変数 > 3014(server/src/config.ts のデフォルトと同じ)
PORT="${PORT:-3014}"

# 初回は依存パッケージをインストールする
if [ ! -d server/node_modules ]; then
  echo "server/node_modules が無いため npm install を実行します"
  (cd server && npm install)
fi

# 既存プロセスがポートを掴んでいれば停止してから起動する
PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "port ${PORT} を使用中のプロセス (${PIDS}) を停止します"
  kill $PIDS 2>/dev/null || true
  sleep 1
  PIDS="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

export PORT
exec node server/src/index.ts
