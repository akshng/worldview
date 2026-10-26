#!/bin/sh
# Build WorldView.app (native macOS window around the local server) and install it
# to ~/Applications.   npm run mac:build
# Needs the Xcode command line tools (swiftc, iconutil). The server itself is the
# LaunchAgent from `npm run service:install`; the app starts it when it's off.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/mac/build"
APP="$OUT/WorldView.app"
ICON_SRC="$ROOT/mac/icon/icon-1024.png"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "• compiling"
swiftc -O -o "$APP/Contents/MacOS/WorldView" "$ROOT/mac/WorldView.swift" -framework Cocoa -framework WebKit

echo "• icon"
SET="$OUT/WorldView.iconset"
rm -rf "$SET"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICON_SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d "$ICON_SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/WorldView.icns"
rm -rf "$SET"

esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>WorldView</string>
  <key>CFBundleDisplayName</key><string>WorldView</string>
  <key>CFBundleIdentifier</key><string>com.worldview.app</string>
  <key>CFBundleExecutable</key><string>WorldView</string>
  <key>CFBundleIconFile</key><string>WorldView</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>WorldView by akshng · Apache-2.0</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>WVProjectDir</key><string>$(esc "$ROOT")</string>
</dict>
</plist>
PLIST

echo "• signing (ad hoc, this Mac only)"
codesign --force --deep -s - "$APP" >/dev/null 2>&1

DEST="$HOME/Applications"
mkdir -p "$DEST"
rm -rf "$DEST/WorldView.app"
cp -R "$APP" "$DEST/"
touch "$DEST/WorldView.app"
echo "WorldView.app installed in ~/Applications (drag it to the Dock to keep it there)."
