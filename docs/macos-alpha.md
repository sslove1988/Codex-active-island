# macOS Alpha

Focus 0.3.0-alpha.1 targets Apple Silicon Macs running macOS 11 or newer.

## Included

- Floating island window, tray menu, dragging and transparent-area click-through.
- Todos, focus timer, reminders, daily Markdown notes and appearance settings.
- Codex session detection from `~/.codex/sessions`.
- macOS shell hooks for Codex and Claude Code.
- Clipboard text/image history through cross-platform polling.
- Launch-at-login through `~/Library/LaunchAgents/com.focusd.island.plist`.
- Basic Music and Spotify playback controls through Apple Events.

## Alpha limitations

- The macOS build is unsigned until Apple Developer signing is configured.
- Clipboard history polling works, but the configurable global clipboard shortcut is Windows-only in this alpha.
- Media state and controls currently cover Music and Spotify; other players may show unavailable.
- Notch placement, multiple displays, Spaces, full-screen apps, sleep and wake require testing on a physical Mac.
- The Windows machine can type-check shared code but cannot produce or fully validate a macOS app bundle. Use the macOS GitHub Actions workflow or a Mac.

## Build

Run the **Build macOS Alpha** workflow from the repository Actions tab. Its artifact contains the unsigned Apple Silicon DMG and app bundle.

On a Mac, the equivalent local command is:

```sh
npm ci
npm run tauri -- build --target aarch64-apple-darwin --bundles app,dmg
```
