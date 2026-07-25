#!/bin/bash
# Pull cloud-specific components from the private homecast-cloud repo.
# Run this before building the full (cloud + community) version.
# Not needed for Community-only builds.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
CLOUD_DIR="$WEB_DIR/../../homecast-cloud/app-web/src"

if [ ! -d "$CLOUD_DIR" ]; then
    echo "[pull-cloud] homecast-cloud repo not found at $CLOUD_DIR"
    echo "[pull-cloud] Skipping — building in Community-only mode"
    exit 0
fi

echo "[pull-cloud] Copying cloud components from homecast-cloud..."
# Wipe first. `cp -r src dest` copies *into* dest when dest already exists, so
# re-running used to nest src/cloud/pages/pages and leave the top-level files
# stale — you'd then build against a mix of old and new cloud UI, with nothing
# to indicate it. A clean copy every time is the only safe form here, and also
# means files deleted upstream actually disappear.
rm -rf "$WEB_DIR/src/cloud"
mkdir -p "$WEB_DIR/src/cloud"
cp -r "$CLOUD_DIR/pages" "$WEB_DIR/src/cloud/pages"
cp -r "$CLOUD_DIR/components" "$WEB_DIR/src/cloud/components"
cp "$CLOUD_DIR/index.ts" "$WEB_DIR/src/cloud/index.ts"

echo "[pull-cloud] Done — $(find "$WEB_DIR/src/cloud" -name "*.tsx" -o -name "*.ts" | wc -l | tr -d ' ') files"
