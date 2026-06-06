#!/usr/bin/env sh

# Generate icon.icns from AppIcon.png for macOS
# This script creates a temporary iconset folder, generates all required sizes,
# converts to icns, then cleans up.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/AppIcon.png"
OUTPUT="$SCRIPT_DIR/icon.icns"
ICONSET="$SCRIPT_DIR/icon.iconset"

if [ ! -f "$SOURCE" ]; then
  echo "Error: Source file not found: $SOURCE"
  exit 1
fi

echo "Generating icon.icns from AppIcon.png..."

# Remove existing iconset if present
rm -rf "$ICONSET"
mkdir "$ICONSET"

# Generate all required icon sizes for macOS
# Format: filename - size
# @2x variants are double the base size

sips -z 16 16     "$SOURCE" --out "$ICONSET/icon_16x16.png"
sips -z 32 32     "$SOURCE" --out "$ICONSET/icon_16x16@2x.png"
sips -z 32 32     "$SOURCE" --out "$ICONSET/icon_32x32.png"
sips -z 64 64     "$SOURCE" --out "$ICONSET/icon_32x32@2x.png"
sips -z 128 128   "$SOURCE" --out "$ICONSET/icon_128x128.png"
sips -z 256 256   "$SOURCE" --out "$ICONSET/icon_128x128@2x.png"
sips -z 256 256   "$SOURCE" --out "$ICONSET/icon_256x256.png"
sips -z 512 512   "$SOURCE" --out "$ICONSET/icon_256x256@2x.png"
sips -z 512 512   "$SOURCE" --out "$ICONSET/icon_512x512.png"
sips -z 1024 1024 "$SOURCE" --out "$ICONSET/icon_512x512@2x.png"

# Convert to icns (macOS only)
iconutil -c icns "$ICONSET" -o "$OUTPUT"

# Clean up
rm -rf "$ICONSET"

echo "Successfully generated: $OUTPUT"
