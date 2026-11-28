# React + Tauri installer

The standalone Windows installer has a frameless, transparent Tauri window,
React controls, direct installation, directory selection, animated feature
panels and a custom progress display. NSIS runs silently in the background;
its wizard, title bar and next/previous buttons are not displayed.

Three feature scenes cover Markdown/preview, themes and document organization.
The chibi scene sheet uses blue/white sneakers in light mode and navy sneakers
in dark mode. The right character stands with both laced sneakers visible.
Motion respects `prefers-reduced-motion`.

## Commands

```powershell
npm run installer:dev         # browser preview; installation is explicitly simulated
npm run installer:tauri:dev   # desktop window; needs a built payload to install
npm run installer:build       # React production build
npm run installer:bundle      # build application, silent payload and standalone EXE
npm run tauri build -- --app   # build the standalone editor EXE without an installer
```

`npm run tauri:build` builds the branded React installer only; no MSI is built.
`npm run tauri:build:nsis` and `npm run installer:bundle` run the same build.
The result is `src-tauri/target/release/react/MokiDown_<version>_x64-setup.exe`.
The payload is embedded into one executable; no adjacent files are needed.
Every package rebuilds the application so its version and updater settings match
the installer. Reusing an older application binary is intentionally rejected.

GitHub Release publishes one branded EXE, its updater signature and latest.json.
First installation and application updates download the exact same file. When
started by the updater (/UPDATE), the installer starts automatically, preserves
the original directory, launches the app and closes without action buttons.
First installation asks only for the location and initial consent, then also
launches the app automatically. No separate manual update package is published.

The editor, branded installer and its NSIS payload declare `asInvoker`.
The installer writes to the current user's install location and checks that
the selected directory is writable before launching the silent payload.

The Windows release workflow requires a trusted code-signing certificate via
`WINDOWS_CERTIFICATE` (base64 PFX) and `WINDOWS_CERTIFICATE_PASSWORD`.
It verifies the Authenticode signature and timestamp before signing the
final installer bytes with the Tauri updater key. The update manifest
points directly to that versioned GitHub asset. Local builds do not publish
unsigned update manifests.

For a signed local build, set `MOKI_WINDOWS_CERT_THUMBPRINT` to the thumbprint of
an Authenticode certificate available to Windows SignTool. Both build commands
use this certificate for their Windows executables. Unsigned local builds and
downloads from a new publisher may trigger
[Microsoft Defender SmartScreen](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation).

Windows launches an EXE with Low integrity when the file inherits a Low label
from its build directory. That process cannot write to ordinary user folders
even when the user's ACL grants access. Set `MOKI_WINDOWS_OUTPUT_DIR` to an
absolute path in an ordinary user folder to create the local build outputs there.
Run the build from a regular PowerShell window.

```powershell
$env:MOKI_WINDOWS_OUTPUT_DIR = Join-Path $env:USERPROFILE 'Downloads/MokiDown-build'
npm run installer:bundle
```

## Installation behavior

Rust extracts the payload into an isolated temporary directory, launches it with
`/S` and the selected `/D` directory, then reads complete phase records written
by `src-tauri/windows/progress.nsh`. Progress represents installation **phases**,
not a download rate or a byte counter. React interpolates only the visual width.
Success requires the child process to succeed and the installed executable to
exist in the requested directory. The app then opens automatically.
Closing the installer is blocked while installation runs.

React-driven installs refuse to force-kill a running editor. Updater behavior
without the React progress argument remains unchanged. Backend failures stay in
the React UI and allow retry. Rust validates paths; no shell executes path text.
The custom UI requires WebView2. The installer probes current-user directories
for write access and uses one temporary workspace per launch for the WebView2
profile, NSIS payload and the silent install's temporary files. If every
candidate fails, the startup dialog lists their paths and the Windows errors.
When WebView2 is missing, the branded EXE starts its embedded NSIS installer.
NSIS can install WebView2 before launching MokiDown. Other window startup
failures are reported in a native dialog.

The payload template is based on tauri-bundler **2.10.1** (MIT / Apache-2.0).
Keep its upgrade, WebView2, association and uninstall logic in sync when upgrading
the CLI. Customizations only add phase reporting and the running-editor guard
for React-driven installs.

After updating, --moki-after-update bypasses the old splash. Native handover
triggers the page reveal only after the editor window is shown. Reduced-motion
preferences disable decorative motion.

## Carousel components

The carousel renders local React compositions from FeatureScenes.jsx: a source/
Markdown preview pair, a real Milkdown auto-typing demonstration, a local Markdown
language-service demonstration, light/dark preview cards, and file-list/knowledge-tree
panels. The Markdown styles, file-row styles, file icons and tree parser come
from the application. It does not load workspace screenshots or initialize the
editor's native services. Existing Moki artwork stays separate, with two new
matching WYSIWYG and language-assistant poses in moki-editor-scenes.png.

The auto-typing scene uses Milkdown commonmark input rules to turn typed markers
into headings, emphasis and quotes. It mounts only while selected and releases
the editor and timers on exit. Reduced-motion mode shows the completed document.
The language scene is a local completion/diagnostics illustration, without
starting a server or installing a language plugin in the installer.

Navigation uses only small dots with an expanding active indicator and a crossfade.
Manual navigation resets the automatic slide timer.
Reference: [Page Controls](https://scaledesignsystem.com/components/page-controls/).

In-app updater progress uses TaskList, following the 320px task panel in
UI/md-editor.html. The status bar uses that reference's spinning segmented icon
and Downloading/Installing status, and reopens the task list when clicked.
Hiding the panel keeps the transfer alive; failures reopen it for retry.
