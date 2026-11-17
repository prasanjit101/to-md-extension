#!/bin/sh
# Builds a Chrome Web Store upload zip from the current manifest version.
set -e
cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/webtext-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -r -q "$OUT" \
  manifest.json background.js content.js \
  icons/icon-16x16.png icons/icon-32x32.png icons/icon-48x48.png icons/icon128.png

echo "Built $OUT"
unzip -l "$OUT"
