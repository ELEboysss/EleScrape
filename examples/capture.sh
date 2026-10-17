#!/usr/bin/env bash
#
# Scripted capture: run a headless capture, then export a CSV.
# Usage: ./examples/capture.sh [url] [out-dir]
#
set -euo pipefail

URL="${1:-http://127.0.0.1:8089/}"
OUT_DIR="${2:-.elescrape/scripted}"
CLI="node bin/elescrape.js"

echo "→ capturing $URL into $OUT_DIR"
"$CLI" capture \
  --url "$URL" \
  --out "$OUT_DIR" \
  --filter '/api/' \
  --duration 15 \
  --quiet

echo "→ recorded requests"
"$CLI" list "$OUT_DIR" --format table

echo "→ exporting CSV"
"$CLI" export "$OUT_DIR" --format csv --out "$OUT_DIR/requests.csv"

echo "done: $OUT_DIR/requests.csv"
