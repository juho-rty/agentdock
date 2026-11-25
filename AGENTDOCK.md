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

Agent-run updates of linked machines (only when the owner asks) download the release into a
per-version folder (`/Users/Shared/agentdock-maintenance/update-<version>/` on a Mac,
`C:\Users\Public\agentdock-maintenance\v<version>\` on Windows), check its sha512 against
`latest*.yml`, and finish with `scripts/agentdock-update-mac.sh` or
`scripts/agentdock-update-windows.ps1`. Both scripts self-detach outside the agent's process
tree (`launchctl bootstrap gui/<uid>` on macOS, WMI `Win32_Process.Create` on Windows) and
strip `ELECTRON_RUN_AS_NODE` so the relaunched Electron app never boots in Node mode or gets
reaped when the old app quits. Paste the script into the task rather than having the agent
copy the previous folder's script. Once the new version is running, the scripts delete the
backup, staged app, download and older version folders. Each kept a full app copy (about
1.3 GB) per update before that.

## Phone

Phones reach each computer over Tailscale. Install Tailscale on the phone and on every
computer and sign them in to the same tailnet. On a computer, open **Settings -> Sharing &
access**, turn on **Tailscale HTTPS** (the server is then served at its `https://<name>.ts.net`
address through Tailscale Serve), and create a pairing link under **Authorized clients**
that uses that address. Open the link or scan its QR code on the phone, and add the page to
the home screen for an app-like window.

Only one computer needs a pairing link. The phone then pairs by itself with every computer
linked to that one with full access, at the Tailscale address the first computer reaches it at.

On the same Wi-Fi you can instead enable **Network access** and pair over the local address.

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
- T3 Code import: `apps/server/src/persistence/importT3CodeData.ts`. On first start the server copies the
  threads and projects of `~/.t3` into AgentDock once; delete `userdata/t3-code-import.json` to run it again.
- UI: `apps/web`, server: `apps/server`
