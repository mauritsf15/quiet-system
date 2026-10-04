# Quiet System

A Wallpaper Engine dashboard for system stats, music, lyrics, weather, and audio visualization. The command pane runs PowerShell on your PC using your Windows account.

## Install

**You need:** Wallpaper Engine and an x64 PC with Windows 10 (version 2004 or newer) or Windows 11. The download includes the .NET runtime; no developer tools are needed.

1. **Download** `Quiet-System-0.1.2-win-x64.zip` from the [Releases page](https://github.com/mauritsf15/quiet-system/releases). Choose the release ZIP, not the source code ZIP.
2. **Extract** it into a permanent folder, such as Documents. Keep the app and `wallpaper` folder together.
3. **Run** **Install Quiet System.cmd**. Follow the prompts to start the background app and optionally enable startup with Windows. No administrator access is needed.
4. **Add the wallpaper:** in Wallpaper Engine, choose **Open Wallpaper → Open from URL** and paste:

   ```text
   http://127.0.0.1:9876/wallpaper/
   ```

5. **Set your weather location** in **settings**. Search for a city or postal code, or select **Use my location** and allow access.
6. **Hide desktop icons** to type in the command pane. Wallpaper Engine's **Desktop icon visibility** shortcut makes switching easier.

The first release is unsigned. If Windows shows a security warning, check that you downloaded it from this repo.

You can also open the URL in a browser. Keep the background app running while using Quiet System.

## Start and stop

- **Start:** double-click **Start Quiet System.cmd** or `QuietSystem.Telemetry.exe`.
- **Start with Windows:** right-click **Enable Startup.ps1** and choose **Run with PowerShell**. Run **Disable Startup.ps1** to turn this off. Keep the installation folder in the same place.
- **Stop:** finish any commands, then run **Stop Quiet System.ps1** or end **QuietSystem.Telemetry** in Task Manager. This closes command sessions.

If Windows blocks startup scripts, press **Win+R**, enter `shell:startup`, and add or remove a shortcut to `QuietSystem.Telemetry.exe`.

## Update or uninstall

**To update:**

1. Finish commands and stop the app.
2. Disable startup from the old folder, if enabled.
3. Extract the new release into a new folder and start it.
4. Enable startup from the new folder, if wanted.
5. Refresh the wallpaper. The URL stays the same; settings usually stay saved.

**To uninstall:**

1. Disable startup and stop the app.
2. Remove the wallpaper from Wallpaper Engine.
3. Delete the installation folder.

Optional cleanup: delete `%LOCALAPPDATA%\QuietSystem` for logs and clear the wallpaper's site data for settings.

## Screens and settings

- **One screen:** the default view puts the dashboard on the left and commands on the right.
- **Two matching screens:** span one wallpaper across both for a 50/50 split.
- **Different sizes, scaling, or vertical arrangement:** use separate wallpapers with the URLs below.
- **Narrow or portrait screen:** the dashboard stacks above commands.

For separate wallpapers:

| Screen | URL |
| --- | --- |
| Dashboard | `http://127.0.0.1:9876/wallpaper/?role=dashboard` |
| Commands | `http://127.0.0.1:9876/wallpaper/?role=commands` |

Open **settings** to change the accent color, interface size, weather location, or weather and storage visibility. Settings are saved locally; separate Wallpaper Engine profiles may have different settings.

- **Music:** playing Spotify takes priority. Pause it to show another playing app. When nothing plays, paused Spotify takes priority.
- **Lyrics:** matched tracks show the current and next line. Availability and timing may differ from Spotify.
- **Audio:** the visualizer shows all system audio from your default output device, from bass to treble.
- **Storage:** readings cover the drive containing Windows. Physical disk stats appear only when it maps to one known disk.

## Use the command pane

Run one PowerShell command at a time. Variables from earlier commands are not kept.

| Action | How |
| --- | --- |
| Browse history | Press ↑ or ↓. |
| Change folder | Use `cd`. |
| Clear output | Use `clear`. |
| Answer a prompt | Use the hidden reply field, then Enter or **SEND**. Replies are not saved in history. |
| Type in an interactive app | Click the output area. The app controls whether typing is visible. |
| Interrupt a program | Press Ctrl+C. |
| End the session | Click **STOP**. |

For SSH, run `ssh user@host` and answer its prompts. Sessions stay open until you exit, stop them, or close the page. Commands stop after one million output characters.

## Data and privacy

- **Local data:** system stats, Windows username, computer name, artwork, playback position, and audio levels stay on your PC. Command history stays in page memory.
- **Local access:** the app listens only at `127.0.0.1:9876`. Commands require the local wallpaper page and a temporary token. Do not expose it through a network proxy.
- **Lyrics:** song title, artist, album, and duration go to [LRCLIB](https://lrclib.net/docs). No Spotify account connection is needed.
- **Weather:** selected coordinates, rounded to three decimal places, go to [Open-Meteo](https://open-meteo.com/). Forecasts refresh every 15 minutes and when you change location or enable weather. Turn weather off to stop forecast requests.
- **City search:** your search goes to Open-Meteo's location service, using [GeoNames](https://www.geonames.org/) data. No location is selected by default.
- **Logs:** stored in `%LOCALAPPDATA%\QuietSystem`; they may contain local paths. Check before sharing.

External services also see your IP address. **Use my location** requests your location once, with permission; it does not track you continuously.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| Page will not open | Start the app. Only one copy can run, and port 9876 must be free. If it exits, check `%LOCALAPPDATA%\QuietSystem\telemetry.log`. |
| Cannot type | Hide desktop icons and use the local URL from the install steps. |
| Missing sensors | Some hardware or drivers do not support every reading. |
| Location detection fails | Search for your city instead. Weather needs internet access. |
| Missing music or audio | Start playback and check the default Windows output device. |
| Missing lyrics | The provider may not have a match for that track. |
| Old interface or strange codes like `[?25h` | Add `?v=0.1.2` to the URL, or `&v=0.1.2` if it already contains `?`. Use a new value for later updates. |

## Development

Install the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0), then:

1. Run `./telemetry/publish.ps1` from the repo folder.
2. Start `telemetry/publish/QuietSystem.Telemetry.exe`.
3. Open the local wallpaper URL from the install steps.

Builds include the runtime. Add `-FrameworkDependent` for a smaller build that requires .NET on the target PC. Before rebuilding, finish commands and stop the app; afterward, restart and refresh.

| Command | Purpose |
| --- | --- |
| `npm run preview` | Preview at `http://127.0.0.1:4173` with sample data and commands disabled. |
| `npm test` | JavaScript checks. |
| `npm run test:media` | Media and lyrics checks. |
| `npm run test:audio` | Audio analysis and device recovery checks. |
| `npm run test:storage` | System disk selection checks. |
| `npm run test:terminal` | Interactive console checks on Windows. |
| `./tools/package-release.ps1 -Version 0.1.2` | Create a release ZIP and SHA256 checksum in `artifacts/releases/`. |

Use the app's local URL for live commands, media, and audio. Add `-- -- --device-check` to the audio test command to check your current output device.

For browser checks, set `QUIET_PLAYWRIGHT_PATH` to a local `playwright/index.mjs`, then run:

```powershell
node tools/check-display-layout.mjs
node tools/check-lyrics-layout.mjs
node tools/check-terminal-appearance.mjs
```

Media and browser checks use local fixtures without external requests. Browser captures go in `artifacts/`.

After changing the pinned xterm.js or fit addon versions, run `npm run vendor:terminal` to refresh the bundled assets and MIT licenses.
