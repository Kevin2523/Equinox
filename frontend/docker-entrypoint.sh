#!/bin/sh
set -eu

ENV_JS="/usr/share/nginx/html/assets/env.js"
API_ORIGIN="${EQUINOX_API_ORIGIN:-}"

mkdir -p "$(dirname "$ENV_JS")"

if [ -n "$API_ORIGIN" ] && [ "$API_ORIGIN" != "same-origin" ]; then
  ESCAPED=$(printf '%s' "$API_ORIGIN" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf 'window.__EQUINOX_API_ORIGIN__ = "%s";\n' "$ESCAPED" > "$ENV_JS"
else
  printf 'window.__EQUINOX_API_ORIGIN__ = window.location.origin;\n' > "$ENV_JS"
fi
