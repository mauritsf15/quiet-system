# Quiet System

A locally hosted Wallpaper Engine dashboard with live hardware telemetry, media artwork, synchronized lyrics, system audio visualization, and a PowerShell command pane. Commands run under your Windows account on your own computer.

## Install

Requirements: Windows 10 (version 2004 or newer) or Windows 11 on an x64 PC, and Wallpaper Engine. The release includes the .NET 8 runtime; you do not need to install .NET, Node.js, or developer tools.

1. Open this repository's **Releases** page and download `Quiet-System-0.1.0-win-x64.zip` (the ready-to-run download, rather than GitHub's automatic source ZIP).
2. Right-click the ZIP and choose **Extract All**. Move the extracted folder somewhere permanent, such as Documents. Keep the executable and `wallpaper` folder together.
3. Double-click **Install Quiet System.cmd** for guided setup. It checks the extracted files, offers to start the companion, asks whether you want startup with Windows, and offers to copy the wallpaper URL and launch Wallpaper Engine. It does not require administrator access. If Windows shows a security warning, verify that the download came from this repository; the first release is unsigned. You can also start the app directly with **Start Quiet System.cmd** or `QuietSystem.Telemetry.exe`.
4. In Wallpaper Engine, choose **Open Wallpaper → Open from URL** and enter `http://127.0.0.1:9876/wallpaper/`.
5. Open **settings** in the wallpaper. Search for your city or postal code, then select the correct result. Alternatively, click **Use my location** and allow location access. If detection is unavailable in Wallpaper Engine, use city search. No location is selected by default.
6. Hide desktop icons before typing in the command pane. Wallpaper Engine only passes keyboard input to locally hosted URL wallpapers while icons are hidden. Its **Desktop icon visibility** shortcut can make switching easier.

### Startup, stopping, updates, and removal

To start with Windows, right-click **Enable Startup.ps1** in the extracted folder and select **Run with PowerShell**. To undo this, run **Disable Startup.ps1** from the same folder. If Windows blocks scripts, open **Win+R → shell:startup** and add or remove a shortcut to `QuietSystem.Telemetry.exe` manually. Do not move the installation folder after enabling startup.

To stop the companion, run **Stop Quiet System.ps1** or end **QuietSystem.Telemetry** in Task Manager. Finish terminal commands first: stopping the companion closes its sessions.

To update, stop the companion, extract the new release into a new folder, disable startup from the old folder, start the new version, and enable startup from the new folder if desired. Refresh the wallpaper; the local URL remains the same. Browser settings normally remain saved.

To uninstall, disable startup, stop the companion, remove the wallpaper from Wallpaper Engine, and delete the extracted folder. Optional local crash logs are under `%LOCALAPPDATA%\QuietSystem`; deleting that folder removes them. Appearance and weather preferences are stored by the browser or Wallpaper Engine and can be removed by clearing its site data.

### Troubleshooting

- **The local page does not open:** start the companion first. Check Task Manager and `%LOCALAPPDATA%\QuietSystem\telemetry.log` if it exits immediately. Only one companion instance can run, and port 9876 must be available.
- **Typing does not work:** hide desktop icons and confirm that you opened the local URL above.
- **Some sensors are unavailable:** hardware and driver support varies. The rest of the dashboard still works.
- **Weather detection fails:** search for a city instead; browser location permission and Windows location services may be unavailable. Weather needs internet access.
- **Music or audio is missing:** start playback in a Windows media player such as Spotify and check the default Windows output device. Lyrics are available only for tracks matched by the provider.
- **Old interface after an update:** reopen `http://127.0.0.1:9876/wallpaper/?v=0.1.0` to bypass an old page cache.

The command pane and live dashboard can also be opened in a normal browser at the same local URL. The companion must be running for the page to load.

## Display layouts

- **One display:** dashboard on the left, command pane on the right.
- **Two-display span:** stretch one URL wallpaper across two equal-width monitors side by side. Wide canvases use a 50/50 split: dashboard on the left, commands on the right. The page cannot discover the physical monitor boundary; use separate wallpapers for unequal widths, different scaling, or vertically arranged monitors.
- **Separate wallpaper per display:** use `http://127.0.0.1:9876/wallpaper/?role=dashboard` on the first monitor and `http://127.0.0.1:9876/wallpaper/?role=commands` on the second. Each role fills its screen and starts only its own services.
- **Narrow or portrait screen:** the combined view stacks dashboard above commands. Dashboard content remains available through its own scrolling area; separate roles keep the full screen.

The **settings** button changes accent color, interface scale, weather location, and weather/storage visibility. Changes are saved in that browser's local storage and synchronize between windows sharing that storage. Separate Wallpaper Engine storage profiles retain their own settings. Location detection is a one-time request made only when you click **Use my location**; the app does not continuously track your location.

Storage details describe the volume containing Windows; physical disk readings are shown only when that volume maps to one known disk. The audio visualizer follows the default output and reconnects after device changes or capture failures. Its 48 bars measure fixed frequency bands from 35 Hz to 16 kHz, ordered from bass to treble, using one shared decibel scale. Peaks rise quickly and fall gently; silence settles to zero. It visualizes all system audio, including sounds from other apps.

Playing Spotify takes priority over YouTube and other local media players. Pausing Spotify lets another playing player take over; resuming Spotify restores its priority. When nothing is playing, paused Spotify takes priority over other paused players. This supports Spotify's Windows desktop and Microsoft Store installations.

When a song has timed lyrics, its current line and upcoming line appear beneath the artist. The space is reserved so lyric changes do not move the dashboard. Pausing freezes the lyrics; seeking updates them directly. Missing lyrics, videos, and unavailable timing leave the area empty. Long lines end with an ellipsis, and reduced-motion preferences disable lyric animation. Lyrics come from LRCLIB, so recording versions, coverage, and timing can differ from Spotify's own lyrics.

## Commands and data

The command pane runs one PowerShell command at a time in a Windows pseudoconsole. Use ↑ and ↓ for command history, `cd` to change the working directory, and `clear` to clear output. While a command runs, the bottom field becomes a hidden reply field: enter a reply and press Enter or **SEND**. Replies are never added to command history. You can also click the output area to type directly in an interactive program; the program controls echo there. For example, run `ssh user@host`, answer any host-key confirmation, then enter your password at SSH's prompt. Ctrl+C interrupts the foreground program; **STOP** ends the entire session. SSH sessions stay open until you exit, stop them, or close the page. PowerShell variables from earlier commands are not retained. A running command is stopped after one million output characters.

If output shows literal escape codes such as `[?25h`, or the lyrics area is missing, the wallpaper is using an old interface. Reopen its local URL with `&v=20261003d` (or `?v=20261003d` if it has no query parameters) to bypass the existing page cache. The companion serves wallpaper files with caching disabled and refuses interactive commands from old interfaces.

The companion listens only on `127.0.0.1:9876`. The command WebSocket requires the local wallpaper origin and a per-run token. Do not expose the companion through a network proxy. Hardware samples, your Windows username and computer name, artwork, playback position, and audio levels are used locally on your computer; they are not uploaded by the companion. Terminal history is kept in page memory. Crash logs stay in `%LOCALAPPDATA%\QuietSystem` and may contain local paths; check them before sharing.

Lyrics lookups send the song title, artist, album, and duration to [LRCLIB](https://lrclib.net/docs), without a Spotify account connection or API key. Matches and missing results are cached in memory, and provider rate-limit cooldowns are honored. Weather requests send the selected coordinates (rounded to three decimal places) to [Open-Meteo](https://open-meteo.com/) and refresh every 15 minutes, and immediately when the location changes or weather is enabled. City search sends the entered city or postal code to Open-Meteo's geocoding service, which uses [GeoNames](https://www.geonames.org/) data. Those external services also see your IP address. No city or personal coordinates are bundled with the app. Disable weather to stop forecast requests; choosing **Use my location** additionally uses your browser's location service with your permission.

## Development

Building from source requires the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Run `./telemetry/publish.ps1`, then start `telemetry/publish/QuietSystem.Telemetry.exe`. The default build bundles the runtime. Pass `-FrameworkDependent` only if you intentionally want a smaller build that requires installed .NET runtimes. Run `./tools/package-release.ps1 -Version 0.1.0` to generate a clean release ZIP and SHA256 checksum under `artifacts/releases/`.

Run `npm test` for the JavaScript checks and `npm run preview` for a browser preview at `http://127.0.0.1:4173`. That preview simulates hardware data and leaves commands disabled. Use the companion's local URL to test live commands, media, and audio.

Run `npm run test:media` for session-priority, Windows timeline, lyric parsing, provider matching/cache/cooldown, and asynchronous track-switch checks. These checks use local fixtures and make no external requests.

Run `npm run test:audio` for frequency-analysis and audio-device recovery fixtures and `npm run test:storage` for system-disk selection fixtures. Use `npm run test:audio -- -- --device-check` to also check native capture initialization on the current output device.

Run `npm run test:terminal` on Windows for interactive console checks. The xterm.js renderer and fit addon are bundled locally with their MIT licenses; after changing their pinned npm versions, run `npm run vendor:terminal` to refresh the assets.

For browser checks, set `QUIET_PLAYWRIGHT_PATH` to a local `playwright/index.mjs` and run `node tools/check-display-layout.mjs`, `node tools/check-lyrics-layout.mjs`, and `node tools/check-terminal-appearance.mjs`. They use local fixtures without external requests. Layout captures are saved under `artifacts/`.

When updating an existing installation, wait for commands to finish, stop the companion, run `./telemetry/publish.ps1`, restart the companion, and refresh the wallpaper. Publishing stops with an error if dependency restore or the build fails.
