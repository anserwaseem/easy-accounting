#!/usr/bin/env bash
# upload Jameel woff2 to the R2 bucket the Worker reads.
# never commit the 10–25MB font. convert TTF → WOFF2 first if needed.
set -euo pipefail

BUCKET="easy-accounting-fonts"
KEY="jameel-noori-nastaleeq.woff2"
FILE="${1:-}"

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "usage: $0 <JameelNooriNastaleeq.woff2|ttf>" >&2
  echo "example: $0 src/renderer/fonts/JameelNooriNastaleeq.ttf" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
UPLOAD="$FILE"

case "$FILE" in
  *.ttf|*.TTF)
    UPLOAD="$WORKDIR/$KEY"
    echo "converting ttf → woff2 (Jameel is ~25MB; first npx fetch + compress ~1 min)"
    # wasm Google woff2 — no pip, no native compile, works on a stock Mac npm
    npx --yes -p wawoff2 woff2_compress.js "$FILE" "$UPLOAD"
    ;;
  *.woff2|*.WOFF2) ;;
  *)
    echo "expected .woff2 or .ttf, got $FILE" >&2
    exit 1
    ;;
esac

if ! npx wrangler r2 bucket list | grep -q "$BUCKET"; then
  # --update-config false: wrangler 4.129+ otherwise interactively rewrites
  # wrangler.jsonc with binding `easy_accounting_fonts`, which is not env.FONTS
  npx wrangler r2 bucket create "$BUCKET" --update-config false
fi

npx wrangler r2 object put "$BUCKET/$KEY" --file="$UPLOAD" --content-type="font/woff2" --remote
echo "uploaded s3://$BUCKET/$KEY — served at /fonts/$KEY (remote R2, not .wrangler/state)"
