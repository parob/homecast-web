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
mkdir -p "$WEB_DIR/src/cloud"
cp -r "$CLOUD_DIR/pages" "$WEB_DIR/src/cloud/pages"
cp -r "$CLOUD_DIR/components" "$WEB_DIR/src/cloud/components"
cp "$CLOUD_DIR/index.ts" "$WEB_DIR/src/cloud/index.ts"

echo "[pull-cloud] Done — $(find "$WEB_DIR/src/cloud" -name "*.tsx" -o -name "*.ts" | wc -l | tr -d ' ') files"
