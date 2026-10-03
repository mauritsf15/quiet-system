# Wallpaper review — 3 October 2026

## Visual design and display behavior

The subdued blue accent, dark surfaces, thin rules, monospace system text, and larger media text form a consistent dashboard. Keep that visual language and the existing PowerShell pane. The changes below repair behavior within it.

| Setup | Behavior after the fixes |
| --- | --- |
| Standard landscape display | Dashboard on the left and commands on the right; resource cards use two columns when the dashboard is narrow. |
| Wide canvas, including an equal-width two-monitor span | A centered 50/50 boundary; resource cards use four columns when the dashboard itself has enough room. |
| Separate dashboard and command wallpapers | Each role fills its monitor and connects only to its own services. |
| Narrow or portrait combined display | Dashboard above commands; all dashboard sections remain accessible through dashboard scrolling. |
| Unequal-width monitors, different scaling, or vertical arrangement | Use separate role URLs. Automatic layout knows the browser viewport, not physical monitor boundaries. |

The review covers browser rendering of the repository sources. It does not establish physical monitor geometry or verify Wallpaper Engine's keyboard forwarding, browser storage partitioning, or pause/resume behavior on the user's desktop.

## Root causes and fixes

### Separate roles lost space and controls on small screens

**Root cause:** the global narrow-screen media rule assigned two grid rows even when only one role was visible, limiting that role to 48% of the canvas. It also hid the settings header, artwork, lyrics, spectrum, and graphs for every role. A portrait display just above the width breakpoint retained two very narrow side-by-side panes.

**Plan and implementation:** keep explicit roles in one full-height grid row, scope stacking to the combined view, preserve all dashboard sections, and allow internal scrolling when needed. Choose resource-card density and compact media layout using the dashboard's available width. Wrap the command header so it remains inside small panes.

### The interface scale control changed little of the interface

**Root cause:** the scale variable changed the body's font size, but most visible text used `rem`, which inherits the unchanged root size. Terminal output also captured its font and theme when created, so later changes did not reach existing output. Saved preferences bypassed validation, allowing malformed scales, booleans, and colors to disagree with the controls or invalidate CSS.

**Plan and implementation:** apply scale at the document root, give compact media enough scaled height, refresh existing terminal fonts/themes and fit, and normalize preferences before updating controls, CSS, and state. Keep the existing 85–115% range. Listen for storage events so windows sharing storage receive appearance changes without a write loop; dispose the handlers on exit.

### Two separate wallpapers started duplicate hidden services

**Root cause:** role selection changed CSS only. Both roles still initialized hardware telemetry, weather, media/audio, lyrics, resource rendering, and the command service. A dashboard-only page could also focus its invisible command field.

**Plan and implementation:** select services at startup. Dashboard roles run dashboard services; command roles run commands. The command connection provides username and hostname so it does not need a hardware feed. Spectrum bars are created only when the dashboard starts. The combined view retains both services. Separate role pages now open three sockets in total instead of six.

### Disconnects retained misleading media and could leave an orphan connection

**Root cause:** closing the live socket cleared lyrics and audio but left the last media state marked PLAYING. A command-token request finishing after page disposal could still open its WebSocket.

**Plan and implementation:** clear media availability on disconnect until fresh media arrives, and check disposal after the asynchronous token request before creating the command socket.

### Visible buttons had no behavior

**Root cause:** the page included `chat` and `open window` controls plus hidden chat markup, but neither the frontend nor companion implemented those features. The open-window control also lacked the corresponding styling.

**Plan and implementation:** remove these unfinished controls and unused markup. Keep the supported PowerShell workflow and its existing clear/run/stop actions.

### Audio capture did not recover from output-device changes

**Root cause:** the service resolved the default output once at startup. RecordingStopped marked capture unavailable but never restarted it; switching speakers/headphones left the capture attached to the old endpoint.

**Plan and implementation:** use one background recovery loop, resolve the default endpoint periodically, recreate capture after a device change or failure, clear stale levels, and ignore callbacks belonging to the previous capture. Keep the existing FFT and 48-bar visualizer.

### Storage could mix readings from different disks

**Root cause:** storage capacity always came from the Windows volume, while physical activity and temperature came from the first enumerated storage device. Enumeration order does not identify the Windows disk.

**Plan and implementation:** match the Windows drive letter against physical disk partitions. Read physical sensors only from a unique matching disk. Preserve Windows-volume capacity when mapping is unavailable, leaving unmatched physical sensors unavailable. Do not substitute a different disk or use disk activity as a capacity percentage.

### Publishing could report success after a failed build

**Root cause:** PowerShell's terminating-error preference did not stop the script when the native `dotnet` process returned a failure code. The script could copy interface files and print a success message with an old or missing executable.

**Plan and implementation:** check the native exit code after restore and publish, and stop immediately with a message naming the failed step. Preserve the existing publication workflow.

## Validation

- 27 JavaScript checks covering appearance, role startup, disconnect cleanup, lyric timing, and existing helpers.
- 43 browser display scenarios: 14 sizes/modes at 85%, 100%, and 115% scale, plus synchronization between two pages sharing storage. Checks cover full-size explicit roles, service connections, horizontal bounds, media fit, scale, and command input visibility. Screenshots were inspected for desktop, compact, span, portrait, and small dashboard layouts.
- 17 existing browser lyric scenarios, updated to require available media on narrow screens; includes track changes, pause, seeks, stale playback, disconnect, and reduced motion.
- 3 browser terminal-appearance scenarios with real xterm and stubbed command traffic, covering existing output reflow, active session dimensions, and local/cross-window preference changes.
- Existing Windows terminal integration checks, including interactive input, SSH, resize, interruption, cancellation, and disconnect cleanup.
- 34 existing media/lyrics integration checks with local fixtures.
- 13 audio recovery checks covering endpoint changes, failed capture, missing devices, stale callbacks, and cleanup; native capture initialization also passed on the current output device.
- 7 storage-selection checks covering enumeration order, missing and ambiguous mappings, and removed disks.
- Publish-script failure and success paths verified with native-process stubs, without replacing the running installation.
- Companion build succeeds. Package vulnerability metadata could not be fetched in the restricted network environment; packages were available in the local cache.

Browser checks make no external requests. Captures are saved under `artifacts/display-audit/after/`; the earlier layout is recorded under `artifacts/display-audit/before/`. Generated captures and build products are ignored by Git.

## Applying the repository changes

The source fixes do not replace the already-running published companion. When no command is running, stop the companion, run `telemetry/publish.ps1`, restart it, and reload the wallpaper URL. The interface revision is `20261003d`.
