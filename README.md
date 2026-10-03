# Quiet System

A locally hosted Wallpaper Engine dashboard with live hardware telemetry, media artwork, synchronized lyrics, system audio visualization, and a PowerShell command pane. Commands run under your Windows account on your own computer.

## Install

Requirements: Windows 10 or 11, Wallpaper Engine, and the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).

1. From PowerShell, run `./telemetry/publish.ps1` in this repository.
2. Start `telemetry/publish/QuietSystem.Telemetry.exe`. Run `./telemetry/install-startup.ps1` if you want the companion to start with Windows.
3. In Wallpaper Engine, choose **Open from URL** and enter `http://127.0.0.1:9876/wallpaper/`.
4. Hide desktop icons before typing in the command pane. Wallpaper Engine only passes keyboard input to locally hosted URL wallpapers while icons are hidden. Its **Desktop icon visibility** shortcut can make switching easier.

The command pane and live dashboard can also be opened in a normal browser at the same local URL. The companion must be running for the page to load.

## Display layouts

- **One display:** dashboard on the left, command pane on the right.
- **Two-display span:** stretch one URL wallpaper across two equal-width monitors side by side. Wide canvases use a 50/50 split: dashboard on the left, commands on the right. The page cannot discover the physical monitor boundary; use separate wallpapers for unequal widths, different scaling, or vertically arranged monitors.
- **Separate wallpaper per display:** use `http://127.0.0.1:9876/wallpaper/?role=dashboard` on the first monitor and `http://127.0.0.1:9876/wallpaper/?role=commands` on the second. Each role fills its screen and starts only its own services.
- **Narrow or portrait screen:** the combined view stacks dashboard above commands. Dashboard content remains available through its own scrolling area; separate roles keep the full screen.

The **settings** button changes accent color, interface scale, and weather/storage visibility. Changes are saved in that browser's local storage and synchronize between windows sharing that storage. Separate Wallpaper Engine storage profiles retain their own settings.

Playing Spotify takes priority over YouTube and other local media players. Pausing Spotify lets another playing player take over; resuming Spotify restores its priority. When nothing is playing, paused Spotify takes priority over other paused players. This supports Spotify's Windows desktop and Microsoft Store installations.

When a song has timed lyrics, its current line and upcoming line appear beneath the artist. The space is reserved so lyric changes do not move the dashboard. Pausing freezes the lyrics; seeking updates them directly. Missing lyrics, videos, and unavailable timing leave the area empty. Long lines end with an ellipsis, and reduced-motion preferences disable lyric animation. Lyrics come from LRCLIB, so recording versions, coverage, and timing can differ from Spotify's own lyrics.

## Commands and data

The command pane runs one PowerShell command at a time in a Windows pseudoconsole. Use ↑ and ↓ for command history, `cd` to change the working directory, and `clear` to clear output. While a command runs, the bottom field becomes a hidden reply field: enter a reply and press Enter or **SEND**. Replies are never added to command history. You can also click the output area to type directly in an interactive program; the program controls echo there. For example, run `ssh user@host`, answer any host-key confirmation, then enter your password at SSH's prompt. Ctrl+C interrupts the foreground program; **STOP** ends the entire session. SSH sessions stay open until you exit, stop them, or close the page. PowerShell variables from earlier commands are not retained. A running command is stopped after one million output characters.

If output shows literal escape codes such as `[?25h`, or the lyrics area is missing, the wallpaper is using an old interface. Reopen its local URL with `&v=20261003d` (or `?v=20261003d` if it has no query parameters) to bypass the existing page cache. The companion serves wallpaper files with caching disabled and refuses interactive commands from old interfaces.

The companion listens only on `127.0.0.1:9876`. The command WebSocket requires the local wallpaper origin and a per-run token. Do not expose the companion through a network proxy. Hardware samples, artwork, playback position, and audio levels stay on the computer. Lyrics lookups send the song title, artist, album, and duration to [LRCLIB](https://lrclib.net/docs), without a Spotify account connection or API key. Matches and missing results are cached in memory, and provider rate-limit cooldowns are honored. Weather uses [Open-Meteo](https://open-meteo.com/) for Wassenaar and refreshes at most every 15 minutes; turn off weather in settings to stop those requests.

## Development

Run `npm test` for the JavaScript checks and `npm run preview` for a browser preview at `http://127.0.0.1:4173`. That preview simulates hardware data and leaves commands disabled. Use the companion's local URL to test live commands, media, and audio.

Run `npm run test:media` for session-priority, Windows timeline, lyric parsing, provider matching/cache/cooldown, and asynchronous track-switch checks. These checks use local fixtures and make no external requests.

Run `npm run test:terminal` on Windows for interactive console checks. The xterm.js renderer and fit addon are bundled locally with their MIT licenses; after changing their pinned npm versions, run `npm run vendor:terminal` to refresh the assets.

For browser layout checks, set `QUIET_PLAYWRIGHT_PATH` to a local `playwright/index.mjs` and run `node tools/check-display-layout.mjs` and `node tools/check-lyrics-layout.mjs`. They use local fixtures without external requests and save screenshots under `artifacts/`.
