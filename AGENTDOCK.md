# AgentDock

AgentDock is a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT).
It installs next to the official T3 Code and the old Swift AgentDock without
touching either:

|                  | T3 Code              | old AgentDock                   | AgentDock (this repo)    |
| ---------------- | -------------------- | ------------------------------- | ------------------------ |
| App ID           | `com.t3tools.t3code` | `local.agentdock.app`           | `com.agentdock.desktop`  |
| Data folder      | `~/.t3`              | `~/.agentdock`                  | `~/.agentdock-next`      |
| Electron profile | `t3code-v2`          | –                               | `agentdock-next`         |
| Command line     | `t3`                 | –                               | `agentdock`              |
| Source           | –                    | `Dropbox/Apps/AgentDock-legacy` | `Dropbox/Apps/AgentDock` |

## Working on it

The repository lives in `Dropbox/Apps/AgentDock` so every machine sees the
same source. Dependencies and build output (`node_modules`, `dist`, `release`,
`native/resource-monitor/target`, …) are marked Dropbox-ignored, so each machine
installs its own. On a new machine, or after cloning fresh:

```sh
# mark build folders ignored before installing (macOS)
tools/dropbox-ignore.sh
vp i
```

Needs [Vite+](https://viteplus.dev) (`curl -fsSL https://vite.plus | bash`) and Rust (`rustup`).

```sh
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

## GitHub

- `main` on `github.com/juho-rty/agentdock` is the source of truth. Commit and push from any machine.
- Every push and pull request runs typecheck and desktop tests (`.github/workflows/agentdock-check.yml`).
- Releases: push a tag and GitHub Actions builds the macOS DMG and Windows installer and
  publishes them as a GitHub Release (`.github/workflows/agentdock-release.yml`):

  ```sh
  git tag v0.1.11 && git push origin v0.1.11
  ```

  When the build finishes, copy it to the public update feed and to
  `Dropbox/Apps/AgentDock-installers`:

  ```sh
  scripts/agentdock-publish-release.sh v0.1.11
  ```

- Upstream T3 Code is the `upstream` remote (tags not fetched, so they never clash with ours):

  ```sh
  git fetch upstream && git merge upstream/main
  ```

- Upstream's own workflows are parked in `.github/workflows-upstream/` (they need paid runners and secrets).

Builds are unsigned. First launch: on macOS, right-click the app and choose Open; on
Windows, choose "More info -> Run anyway" in SmartScreen. This repository is private, so
installed apps look for updates in the public `juho-rty/agentdock-releases` (installers only,
no source). Windows updates itself from there. macOS refuses to auto-update ad-hoc signed
builds, so install the new DMG from `Dropbox/Apps/AgentDock-installers` instead.

## Phone

Open **Settings -> Sharing & access** in the desktop app, enable **Network access**,
and create a pairing link. Open that link in the phone's browser (same Wi-Fi or
Tailscale). Add it to the home screen for an app-like window.

## The old AgentDock

The old Swift app was retired on 2026-11-19. It was quit on every machine, its
Windows login entry was removed, and its Cloudflare relay (`agentdock-relay`)
had its workers.dev address disabled. Its source is kept in
`Dropbox/Apps/AgentDock-legacy` and its data in `~/.agentdock`; nothing here reads either.

The new app still keeps its data in `~/.agentdock-next`. To move it to `~/.agentdock`
later, first move the old `~/.agentdock` aside, then change `.agentdock-next` in
`apps/desktop/src/app/DesktopStatePaths.ts`, `apps/server/src/os-jank.ts`,
`apps/server/src/cli/browser.ts`, and the profile names in `apps/desktop/src/app/DesktopUserData.ts`.

## Where things live

- Name and IDs: `apps/desktop/src/app/DesktopEnvironment.ts`, `scripts/build-desktop-artifact.ts`
- Data folder: `apps/desktop/src/app/DesktopStatePaths.ts`, `apps/server/src/os-jank.ts`
- Icons: `assets/agentdock/` (copied over `assets/prod`, `assets/nightly`, `apps/web/public`)
- UI: `apps/web`, server: `apps/server`
