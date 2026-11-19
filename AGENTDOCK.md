# AgentDock

AgentDock is a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT).
It installs next to the official T3 Code without touching it:

|                  | T3 Code              | AgentDock               |
| ---------------- | -------------------- | ----------------------- |
| App ID           | `com.t3tools.t3code` | `com.agentdock.desktop` |
| Data folder      | `~/.t3`              | `~/.agentdock-next`     |
| Electron profile | `t3code-v2`          | `agentdock-next`        |
| Command line     | `t3`                 | `agentdock`             |

## Build locally

Needs [Vite+](https://viteplus.dev) (`curl -fsSL https://vite.plus | bash`) and Rust (`rustup`).

```sh
vp i
vp run dev:desktop                 # run the desktop app from source
vp run dist:desktop:dmg:arm64      # macOS installer -> release/
```

Windows installer from a Mac (cross-build):

```sh
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin@0.23.1
cargo xwin build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-pc-windows-msvc
T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true vp run dist:desktop:win:x64
```

## Release

Push a tag and GitHub Actions builds the macOS DMG and Windows installer and
publishes them as a GitHub Release (`.github/workflows/agentdock-release.yml`):

```sh
git tag v0.1.11 && git push origin v0.1.11
```

Release builds look for updates in this repository's releases. Builds are
unsigned, so macOS auto-update may refuse them; installing the new DMG always
works. First launch: on macOS, right-click the app and choose Open the first time; on
Windows, choose "More info -> Run anyway" in SmartScreen.

## Phone

Open **Settings -> Sharing & access** in the desktop app, enable **Network access**,
and create a pairing link. Open that link in the phone's browser (same Wi-Fi or
Tailscale). Add it to the home screen for an app-like window.

## Where things live

- Name and IDs: `apps/desktop/src/app/DesktopEnvironment.ts`, `scripts/build-desktop-artifact.ts`
- Data folder: `apps/desktop/src/app/DesktopStatePaths.ts`, `apps/server/src/os-jank.ts`
- Icons: `assets/agentdock/` (copied over `assets/prod`, `assets/nightly`, `apps/web/public`)
- UI: `apps/web`, server: `apps/server`
- Upstream workflows (disabled): `.github/workflows-upstream/`
