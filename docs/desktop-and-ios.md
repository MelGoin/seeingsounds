# Desktop and iOS app

Seeing Sounds is packaged with [Tauri 2](https://v2.tauri.app). Tauri shows the
same React front end in the operating system's own web view (WKWebView on macOS
and iOS, WebView2 on Windows, WebKitGTK on Linux) and wraps it in a small native
app. The audio math engine runs in a Web Worker inside the app, so the app works
offline and needs no server.

The Tauri project lives in [`src-tauri/`](../src-tauri/).

## Tools to install

Every platform needs:

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs), installed with `rustup`

Then, per platform:

| Platform | Also install |
|---|---|
| macOS (desktop) | Xcode from the Mac App Store. Open it once to accept the license. |
| iOS | A Mac with the full Xcode app, [CocoaPods](https://cocoapods.org) (`brew install cocoapods`), and the iOS Rust targets below. An Apple Developer account is needed for TestFlight and the App Store. |
| Windows | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++". WebView2 ships with Windows 11. |
| Linux (Debian/Ubuntu) | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` |

iOS Rust targets:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

iOS apps can only be built on a Mac. Each desktop installer is built on its own
operating system.

## Desktop

Install the JavaScript dependencies once:

```bash
npm install
```

Run the app in development, with hot reload:

```bash
npm run tauri dev
```

Build an installer:

```bash
npm run tauri build
```

The result is in `src-tauri/target/release/bundle/`: a `.dmg` and `.app` on
macOS, `.msi` and `.exe` on Windows, `.deb`, `.rpm` and `.AppImage` on Linux.

## iOS

Generate the Xcode project once. This creates `src-tauri/gen/apple/`, which you
should commit:

```bash
npm run tauri ios init
```

Run in the iOS Simulator, or on an iPhone connected by cable:

```bash
npm run tauri ios dev
```

To use a physical iPhone, open `src-tauri/gen/apple/*.xcodeproj` in Xcode once,
pick your team under Signing & Capabilities, and keep the phone on the same
Wi-Fi network as the Mac. The dev server listens on the address Tauri passes in
`TAURI_DEV_HOST` (see `vite.config.ts`).

Build for TestFlight or the App Store:

```bash
npm run tauri ios build
```

Then upload the archive from Xcode (Window > Organizer) or with Transporter.

## Before you publish

- **Bundle identifier.** `identifier` in `src-tauri/tauri.conf.json` is set to
  `app.seeingsounds.desktop`. Change it to a reverse domain you own (for example
  `com.yourcompany.seeingsounds`) before the first App Store upload. It cannot
  be changed after release.
- **Icons.** `src-tauri/icons/` holds Tauri's placeholder icons. Generate the
  full set from one 1024x1024 PNG with `npm run tauri icon path/to/icon.png`.
- **Code signing.** macOS builds need a Developer ID certificate and
  notarization to open without warnings on other Macs. Windows builds should be
  signed to avoid SmartScreen warnings. See Tauri's
  [distribution guides](https://v2.tauri.app/distribute/).

## How the pieces fit

| Piece | Where | Used by |
|---|---|---|
| React front end | `src/` | Web, desktop, iOS |
| Math engine | `src/engine/` | Run in the app by `analysisWorker.ts`; also by `server.ts` |
| Sample track generator | `src/engine/sampleTrack.ts` | The app's "Try the sample track" button and `/api/sample-track` |
| Native shell | `src-tauri/` | Desktop and iOS |
| Node server | `server.ts` | `npm run dev` and the HTTP API only; not shipped in the apps |
| Python tools | `math_engine.py`, `visualizer/` | Separate command-line tools; not part of the apps |
