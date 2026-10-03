# Quiet System

A locally hosted Wallpaper Engine dashboard with live hardware telemetry, media artwork, system audio visualization, and a PowerShell command pane. Commands run under your Windows account on your own computer.

## Install

Requirements: Windows 10 or 11, Wallpaper Engine, and the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).

1. From PowerShell, run `./telemetry/publish.ps1` in this repository.
2. Start `telemetry/publish/QuietSystem.Telemetry.exe`. Run `./telemetry/install-startup.ps1` if you want the companion to start with Windows.
3. In Wallpaper Engine, choose **Open from URL** and enter `http://127.0.0.1:9876/wallpaper/`.
4. Hide desktop icons before typing in the command pane. Wallpaper Engine only passes keyboard input to locally hosted URL wallpapers while icons are hidden. Its **Desktop icon visibility** shortcut can make switching easier.

The command pane and live dashboard can also be opened in a normal browser at the same local URL. The companion must be running for the page to load.

## Display layouts

- **One display:** dashboard on the left, command pane on the right.
- **Two-display span:** stretch one URL wallpaper across both monitors. Each half is exactly one monitor wide: dashboard on the left, commands on the right.
- **Separate wallpaper per display:** use `http://127.0.0.1:9876/wallpaper/?role=dashboard` on the first monitor and `http://127.0.0.1:9876/wallpaper/?role=commands` on the second.

The **settings** button changes accent color, interface scale, and weather/storage visibility. Changes are saved in that browser's local storage.

## Commands and data

The command pane runs one PowerShell command at a time in a Windows pseudoconsole. Use ↑ and ↓ for command history, `cd` to change the working directory, and `clear` to clear output. While a command runs, the bottom field becomes a hidden reply field: enter a reply and press Enter or **SEND**. Replies are never added to command history. You can also click the output area to type directly in an interactive program; the program controls echo there. For example, run `ssh user@host`, answer any host-key confirmation, then enter your password at SSH's prompt. Ctrl+C interrupts the foreground program; **STOP** ends the entire session. SSH sessions stay open until you exit, stop them, or close the page. PowerShell variables from earlier commands are not retained. A running command is stopped after one million output characters.

If output shows literal escape codes such as `[?25h`, the wallpaper is using an old interface. Reopen its local URL with `&v=20261003b` (or `?v=20261003b` if it has no query parameters) to bypass the existing page cache. The companion serves wallpaper files with caching disabled and refuses interactive commands from old interfaces.

The companion listens only on `127.0.0.1:9876`. The command WebSocket requires the local wallpaper origin and a per-run token. Do not expose the companion through a network proxy. Hardware samples, current media information, and audio levels stay on the computer. Weather uses [Open-Meteo](https://open-meteo.com/) for Wassenaar and refreshes at most every 15 minutes; turn off weather in settings to stop those requests.

## Development

Run `npm test` for the JavaScript checks and `npm run preview` for a browser preview at `http://127.0.0.1:4173`. That preview simulates hardware data and leaves commands disabled. Use the companion's local URL to test live commands, media, and audio.

Run `npm run test:terminal` on Windows for interactive console checks. The xterm.js renderer and fit addon are bundled locally with their MIT licenses; after changing their pinned npm versions, run `npm run vendor:terminal` to refresh the assets.
