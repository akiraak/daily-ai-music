#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/ios"

SCHEME="DailyAIMusic"
PROJECT="DailyAIMusic.xcodeproj"
BUNDLE_ID="com.akiraak.dailyaimusic"
SERVER_PORT="${PORT:-3014}"

PROD_BASE_URL="https://music.chobi.me"

usage() {
  cat <<'USAGE'
Usage: run-ios-device.sh [--local]

本番サーバー(https://music.chobi.me)に接続するビルドを実機にインストール・起動する。
リポジトリ直下 .env の API_SECRET を注入する。

  --local  本番の代わりにローカルの server(http://<MacのLAN IP>:3014)へ接続する

環境変数 DEVICE_ID / BACKEND_BASE_URL / BACKEND_API_SECRET で個別に上書きできる。
USAGE
}

USE_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --local) USE_LOCAL=1 ;;
    *) echo "[run-ios-device] 不明なオプション: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

# デバイスIDは DEVICE_ID 環境変数で上書き可能。未指定ならペアリング済みデバイスを自動検出する
if [ -z "${DEVICE_ID:-}" ]; then
  DEVICES_JSON="$(mktemp -t devicectl-devices)"
  trap 'rm -f "$DEVICES_JSON"' EXIT
  xcrun devicectl list devices -j "$DEVICES_JSON" >/dev/null
  device_count="$(jq '.result.devices | length' "$DEVICES_JSON")"
  if [ "$device_count" -eq 0 ]; then
    echo "[run-ios-device] ペアリング済みデバイスが見つかりません。USBで一度接続してペアリングしてください。" >&2
    exit 1
  fi
  if [ "$device_count" -gt 1 ]; then
    echo "[run-ios-device] デバイスが複数見つかりました。DEVICE_ID 環境変数で指定してください:" >&2
    jq -r '.result.devices[] | "\(.identifier)\t\(.deviceProperties.name)"' "$DEVICES_JSON" >&2
    exit 1
  fi
  DEVICE_ID="$(jq -r '.result.devices[0].identifier' "$DEVICES_JSON")"
fi

# バックエンドURLは BACKEND_BASE_URL 環境変数で上書き可能。
# 未指定なら本番サーバー(--local 指定時はMacのLAN IPを自動検出)を使う
if [ -z "${BACKEND_BASE_URL:-}" ]; then
  if [ "$USE_LOCAL" -eq 1 ]; then
    MAC_IP=""
    for iface in en0 en1 en2; do
      MAC_IP="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      [ -n "$MAC_IP" ] && break
    done
    if [ -n "$MAC_IP" ]; then
      BACKEND_BASE_URL="http://${MAC_IP}:${SERVER_PORT}"
      echo "[run-ios-device] BACKEND_BASE_URL=${BACKEND_BASE_URL}(MacのLAN IPを自動検出)"
    else
      echo "[run-ios-device] MacのLAN IPを自動検出できませんでした。アプリの設定画面でサーバーURLを手動設定してください。" >&2
      BACKEND_BASE_URL=""
    fi
  else
    BACKEND_BASE_URL="$PROD_BASE_URL"
    echo "[run-ios-device] BACKEND_BASE_URL=${BACKEND_BASE_URL}(既定: 本番サーバー。ローカル接続は --local)"
  fi
fi

# /api/* 認証用 secret。BACKEND_API_SECRET 環境変数で上書き可能。未指定ならリポジトリ直下の .env から読む
if [ -z "${BACKEND_API_SECRET:-}" ]; then
  SECRET_FILE="$SCRIPT_DIR/.env"
  if [ -f "$SECRET_FILE" ]; then
    BACKEND_API_SECRET="$(grep -E '^API_SECRET=' "$SECRET_FILE" | head -n 1 | cut -d= -f2-)"
    if [ -n "$BACKEND_API_SECRET" ]; then
      echo "[run-ios-device] API Secret を .env から注入します"
    fi
  fi
fi
if [ -z "${BACKEND_API_SECRET:-}" ]; then
  echo "[run-ios-device] API Secret が未指定です。.env の API_SECRET を設定するか、アプリの設定画面で入力してください。" >&2
fi

# 注入する URL / secret でサーバーに疎通確認する(失敗してもビルドは続行。アプリの設定画面で上書きできるため)
if [ -n "$BACKEND_BASE_URL" ] && [ -n "${BACKEND_API_SECRET:-}" ]; then
  ping_status="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' \
    -H "X-API-Secret: $BACKEND_API_SECRET" "$BACKEND_BASE_URL/api/ping" 2>/dev/null || echo 000)"
  case "$ping_status" in
    200) echo "[run-ios-device] 疎通確認 OK: $BACKEND_BASE_URL/api/ping" ;;
    401) echo "[run-ios-device] 警告: API Secret がサーバーと一致しません(401)。アプリの設定画面で正しい Secret を入力してください。" >&2 ;;
    *)   echo "[run-ios-device] 警告: $BACKEND_BASE_URL/api/ping に接続できませんでした(status=$ping_status)。" >&2 ;;
  esac
fi

echo "[run-ios-device] Xcode プロジェクトを生成します(xcodegen)..."
xcodegen generate

echo "[run-ios-device] DEVICE_ID=$DEVICE_ID でビルドします..."
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -destination "id=$DEVICE_ID" -allowProvisioningUpdates \
  BACKEND_BASE_URL="$BACKEND_BASE_URL" BACKEND_API_SECRET="${BACKEND_API_SECRET:-}" build

DERIVED_DATA_APP_DIR="$HOME/Library/Developer/Xcode/DerivedData"
# Index.noindex 配下はSourceKitのインデックス作成用ビルドで、インストール可能な実体ではないため除外する
APP_PATH="$(find "$DERIVED_DATA_APP_DIR" -maxdepth 6 -name "${SCHEME}.app" -path "*Debug-iphoneos*" -not -path "*Index.noindex*" -print -quit)"
if [ -z "$APP_PATH" ]; then
  echo "[run-ios-device] ビルド済みの ${SCHEME}.app が見つかりませんでした。" >&2
  exit 1
fi
echo "[run-ios-device] APP_PATH=$APP_PATH"

echo "[run-ios-device] デバイスへインストールします..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"

echo "[run-ios-device] アプリを起動します..."
xcrun devicectl device process launch --device "$DEVICE_ID" "$BUNDLE_ID"

echo "[run-ios-device] 完了しました。"
