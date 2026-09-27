# Handoff: E-Launcher (Ender Launcher), wire it up end to end

> **Moved.** E-Launcher now has its own repo, `Scwunge/elauncher`, with its history. This
> handoff was written while it was `launcher/` inside the `enderphone` umbrella repo on branch
> `claude/determined-shannon-o1hk9t`: read `launcher/...` paths as this repo's root, the workflow is
> `.github/workflows/build.yml`, and fixes now go on this repo's `master` (or a branch off it), not
> that umbrella branch. The API half (§3) is unchanged: it is in `enderphone-api`.

For the local AI on the owner's Windows PC (`C:\Users\conne`, PowerShell). The cloud built
**E-Launcher**, the EnderPhone Minecraft launcher, from the CobbleGenerations launcher. Everything
below is written and tested in the cloud, but it has **never run on a real desktop**: no real
Microsoft sign-in, no real game launch, no real EnderNet handshake. Your job is to deploy the two
API changes, run the launcher for real, prove capes work in the launcher and in game, and fix what
breaks.

There are no secrets in this file. Where one is needed, the file says where it lives.

Branch **`claude/determined-shannon-o1hk9t`** in two repos. PR:
https://github.com/Scwunge/enderphone/pull/2 (not merged yet).

| Repo | Base | New commits |
|---|---|---|
| `enderphone` (umbrella; the launcher is `launcher/`) | `4d2be20` | `d8c530f` launcher, `1034f29` EnderChat, `76719f5` + `5798b39` Windows build workflow, `c6dfbfe` EnderChat tab is the page, `2fb2899` capes/elytra drawn like the mod, `4ff5e20` thinner elytra, then this handoff (plus the notification app ID and the release upload of `latest.yml`) |
| `enderphone-api` | `3f1688e` (= live) | `329be66` release feed `GET /v1/launcher/releases`, `eaf819d` EnderChat page opens a chat from the URL fragment |

Ready-made exes (unsigned, prereleases built by GitHub Actions):
https://github.com/Scwunge/enderphone/releases (newest: `e-launcher-v0.1.0-build5`), with
`Ender Launcher Setup 0.1.0.exe` (installer) and `E-Launcher-Portable-0.1.0.exe`.

## 1. Pull

```powershell
cd C:\Users\conne\Documents\enderphone
git fetch origin; git checkout claude/determined-shannon-o1hk9t; git pull
cd C:\Users\conne\Documents\enderphone-api
git fetch origin; git checkout claude/determined-shannon-o1hk9t; git pull
```
If the umbrella's `api` submodule is where you keep the API, do the second step in
`enderphone\api` instead. The umbrella's `api` pointer is still `3f1688e`; move it to the merged
API commit once §3 is done.

## 2. What was verified in the cloud (and what wasn't)

Verified by actually running it:
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`: **38 unit tests** covering
  the EnderPhone jar rules, Quick Play arguments, chat logic, the realtime socket, and the cape
  texture port.
- `npm run test:integration`: **10 tests**. EnderChat end to end against a real local
  `enderphone-api` with a fake Mojang session server, including the page's `t=`/`c=`/`dm=` links
  in Chromium.
- API: the full `bash run-tests.sh`, all passing, including the new `test-releases.mjs`.
- Every launcher page was screenshotted in Chromium against a mocked backend.
- The GitHub Actions Windows build (`.github/workflows/e-launcher.yml`) produces both exes.

**Not** verified: anything inside real Electron on Windows. That means Microsoft sign-in (msmc),
game and loader installs, the launch itself, the `<webview>` lockdown, desktop notifications, and
the auto-updater.

## 3. Deploy the API branch (needs the owner's go-ahead)

Two changes, both additive:
1. **`GET /v1/launcher/releases`** (`lib/releases.mjs`, the route in `server.mjs`). This is the
   launcher's jar feed: it lists `DOWNLOADS_DIR`, sha1s each jar and caches the sha1 by mtime.
   Links go through `/v1/dl/`, so launcher installs count on the download total.
2. **`pages/enderchat.html`**: reads `c=<conversationId>` and `dm=<uuid>` from the URL fragment
   as well as `t=`, and re-reads on `hashchange`. The launcher uses these to open a specific chat
   ("message this friend", clicking a notification). Until this is deployed the page just opens
   where it normally would, so nothing breaks.

Steps:
1. In `enderphone-api`: `npm ci` (if `node_modules` is missing), then `bash run-tests.sh`. Expect
   ALL PASSED. `test-addon-servers-http.mjs` is a known flake; rerun it if it trips.
2. Merge the branch into `master` (fast-forward from `3f1688e`) and push.
3. Deploy to enderphone-prod the usual way (`HANDOFF-2026-09-26.md` §2: checksum, syntax check,
   SQLite and code backup under `/opt/enderphone-api/backups/`, restart, health check,
   auto-rollback). Changed files: `server.mjs`, `lib/releases.mjs`, `lib/public-status.mjs`,
   `pages/enderchat.html`. No schema change and no new env var.
4. Check it:
   ```powershell
   curl.exe -s https://api.enderphone.cloud/v1/launcher/releases
   ```
   Expect a JSON list with one entry per jar in `/opt/enderphone-api/site/downloads/` (the
   default `DOWNLOADS_DIR`): loader, Minecraft version, edition, EnderPhone version, sha1, url.
   Only files named like `EnderPhone[-Lite|-Server]-(Fabric|NeoForge)-<mc>-<version>.jar` count.
   An empty list means no jars match that pattern.
5. Update `HANDOFF-2026-09-26.md` §7 with the deploy line and backups, as for earlier deploys.

## 4. EnderPhone jars: what the launcher installs

- The feed in §3 **is** the release list. Uploading a jar to `site/downloads/` publishes it to the
  launcher; nothing else needs to change. The 0.5.8 jars are staged in
  `Desktop\EnderPhone-Jars\release-0.5.8\`, and their website upload is still waiting on the
  owner's launch test.
- If the feed is unreachable, the launcher uses its last good copy. With no copy at all, it falls
  back to the fixed name for `KNOWN_VERSION` in `launcher/src/main/enderphone-mod.js`
  (currently `'0.5.8'`), checked with a HEAD request. **Bump `KNOWN_VERSION` with every mod
  release.**
- Rules (all in `enderphone-mod.js`, covered by `test/enderphone-mod.test.mjs`):
  - It picks the jar for the instance's Minecraft version and loader. Quilt uses the Fabric jar.
  - Every download is sha1-checked. The old jar is replaced only after the new one checks out.
  - On Fabric it adds Fabric API from Modrinth.
  - A jar the player disabled in Content stays disabled.
- 26.x **full** jars are held from the website until mcef-26 is public. The launcher only offers
  what the feed lists, so this needs no launcher change.

## 5. Capes: make sure they work everywhere

The capes feature itself is **already live** (it's in api `3f1688e`, deployed 2026-09-27). The
launcher uses the same endpoints as the phone:
- `GET /v1/cape` returns `{cape, canCustomise, tier, maxBytes, maxSide, maxFrames}`.
- `POST /v1/cape` takes the raw bytes.
- `DELETE /v1/cape` removes the cape.

Code:
- `launcher/src/main/enderphone-api.js` makes the calls.
- `launcher/src/renderer/src/components/WardrobeTab.tsx` is the page.
- `launcher/src/renderer/src/components/SkinViewer3D.tsx` is the 3D preview (skinview3d).
- `launcher/src/renderer/src/cape-art.ts` turns a picture into a cape texture.

Why it didn't render before, in case it resurfaces: an EnderPhone cape is a **picture** (up to
1024px, PNG or GIF), not a 64x32 cape texture. skinview3d rejects anything that isn't 2:1 with
"Bad cape size", and that error was swallowed. `cape-art.ts` is now a **byte-for-byte port** of
enderphone-core's `src/main/java/cloud/enderphone/client/CapeArt.java`:
- Same layout: the cape's outer face, a darker mirrored inner face, and both elytra wings.
- Same scale caps: 8 for a still, 4 for an animation, and 64 frames maximum.
- Same float rounding.

`test/cape-art.test.mjs` holds sha256 hashes that the Java itself produced. If a cape looks wrong,
check that first. **If anyone changes `CapeArt.java`, regenerate those hashes**: write a small Java
main that builds the same pictures with the test's LCG generator and prints the sha256 of
`compose()`'s ARGB output (big-endian). Then update `cape-art.ts` until the test passes again.

### 5a. Supporter tier (the usual reason "it doesn't work")

Custom capes need the **supporter** tier (`CAPE_TIER` in `enderphone-api/lib/capes.mjs`). Without
it, `/v1/cape` returns `cape: null` and the Wardrobe shows "A custom cape comes with the supporter
tier" with a link to `/app/donate`. That's correct behaviour, not a bug.
- **Live:** grant it with `POST https://api.enderphone.cloud/v1/admin/donors`, body
  `{"uuid":"<uuid>","tier":"supporter"}`, header `x-admin-token`. The token is `ADMIN_TOKEN` in the
  API's systemd environment on enderphone-prod; use MasterPanel instead if it has a donors page.
- **Local test API:** `handoff/2026-09-24-custom-capes.md` §5 has the whole recipe (env vars, and
  the curl that grants supporter with `x-admin-token: localadmin`). Point the launcher at it with
  `$env:ENDERPHONE_API_BASE="http://127.0.0.1:8799"` before `npm run dev` (see
  `launcher/.env.example`). The renderer's CSP already allows `http://127.0.0.1:*`.

### 5b. Cape checklist (launcher and game side by side)

1. Launcher: **Wardrobe**, then connect to EnderNet if asked. Expect the cape card to show the
   limits (2MB, 1024px, 128 frames) or the supporter note.
2. Choose a **portrait PNG** (e.g. 200x320). Expect the model to turn round, and your picture on
   the cape's back, the right way up and not mirrored. **Save cape**.
3. **Elytra** toggle: expect the picture on both wings.
4. A **square PNG** and a **wide PNG** (e.g. 1024x300): cropped to fit, never squashed. A **GIF**
   should animate at its own speed.
5. A file over 2MB: expect a clear refusal before upload. A renamed JPEG: expect the server's
   refusal shown in red.
6. Launch the same account in game (EnderPhone instance) and press F5. The cape should match
   the launcher preview pixel for pixel: same crop, same darker inside. Put on an elytra and
   compare the wings.
7. A second player (or a second account on the same API) sees it within about 2 minutes (the
   cosmetics refresh).
8. **Remove** in the launcher: gone from the preview, and in game after the refresh.

If the preview is blank, the red text under the model now says why (download failed with a
status, or an unreadable file). Also check DevTools (Ctrl+Shift+I in a dev build) for CSP
errors: cape blob URLs are under `PUBLIC_BASE` (`https://api.enderphone.cloud/...`), which
`connect-src` allows.

### 5c. Decision for the owner: elytra thickness

The owner asked for a thinner elytra, so the **launcher preview** draws the wings at half depth
(`ELYTRA_DEPTH = 0.5` in `SkinViewer3D.tsx`, applied as `scale.z` on the wing meshes). **In game
the elytra is still vanilla**: 10x20x2, inflated to 12x22x4, drawn by vanilla's renderer. So the
preview is slightly thinner than the game. Ask the owner which they want:
- **Preview should match the game:** set `ELYTRA_DEPTH = 1` (one line).
- **Game should be thin too:** a mod change in both trees (`mod` 1.21.1 and `mod-26`). This means a
  mixin on the elytra model/layer that scales the wing depth, only for players wearing an
  EnderPhone cape. It's uncompiled work with a visual check, so treat it as its own task, not part
  of this handoff.

## 6. First real run on Windows

```powershell
cd C:\Users\conne\Documents\enderphone\launcher
npm install
npm test                      # expect 38 passing
npm run dev                   # or run the build5 exe
```
Integration tests (optional, already green in the cloud; Node 22+, run `npm ci` in the API first):
```powershell
$env:ENDERPHONE_API_DIR="..\api"; npm run test:integration   # expect 10 passing
```

Go through these in order. Note pass or fail for each, and fix anything that fails:
1. **Microsoft sign-in.** Expect your name and skin in the title bar.
2. **Connect to EnderNet.** Expect the Mojang handshake to succeed without asking for a password.
   An account with an EnderPhone password gets a password prompt: a wrong password must say so,
   and the right one must connect. The token lasts 12 hours and the launcher reconnects after 11.
3. **New EnderPhone instance**, 1.21.1 Fabric, EnderPhone full, with Sodium. Expect one progress
   run: Minecraft, loader, EnderPhone jar, Fabric API, Sodium. Then **Play**: the game opens with
   EnderPhone loaded (open the phone). Repeat on NeoForge, and with a 26.x Lite instance.
4. Press **Play** again with a newer jar in the feed. Expect the jar to update, and the old one to
   be gone from `mods\`. Disable the jar in Content, then Play: it must stay disabled.
5. **Servers**, then **Join** on a server. Expect the game to go straight into that server (Quick
   Play on 1.20+).
6. Instance, then **Worlds**: *Play* on a world goes straight into it. **Logs**: `latest.log`
   shows, and the warnings/errors filter works.
7. **EnderChat** tab: expect the Discord-style page, already signed in. Friend click in the right
   sidebar opens the DM (needs §3 deployed). Send yourself a message from the phone with the
   launcher unfocused: expect a desktop notification and the unread badge. With the game running,
   expect no notification.
8. **EnderNet** tab: Enderbook, Endportal, Sites, Hosting and Account pages load signed in.
   External links open in the system browser, never inside the launcher.
9. Settings: **"Appear online while E-Launcher is open"**. On: friends see you online (the launcher
   holds `/v1/ws` the way the phone does). Off: nobody sees you online, and the badge polls instead.
   **Chat notifications** off: no desktop notifications.
10. **Wardrobe**: §5b.
11. **While the game runs** (minimize, hide or keep): check each option does what it says.

Where to look when something fails:
- Launcher data is in `%APPDATA%\Ender Launcher\` (electron-store `config.json`, which holds
  settings, the EnderNet session and the release cache).
- Game logs are in each instance's `logs\latest.log`.
- The launcher's own console output shows in the `npm run dev` terminal.
- DevTools opens with Ctrl+Shift+I in dev.

Probably fragile, since it was never run for real:
- msmc's popup flow in a packaged build.
- `@xmcl/installer` NeoForge installs on 26.x.
- The `<webview>` in a packaged build (`webviewTag: true` in `src/main/index.js`, partition
  `persist:endernet`).
- Desktop notifications: `src/main/index.js` sets the app ID `cloud.enderphone.launcher` (the same
  as the NSIS shortcut's). Test them with the installed build: in `npm run dev` Windows may not
  show them.

Commit each fix on `claude/determined-shannon-o1hk9t` and push. That updates PR #2, and the
workflow builds a new exe release.

## 7. Auto-update and release hosting

- `electron-updater` looks at `https://enderphone.cloud/launcher/latest.yml` (generic provider,
  `publish` in `launcher/package.json`). **Nothing is hosted there yet.**
- The workflow now attaches `latest.yml` and the `.blockmap` files to each GitHub release,
  alongside the exes.
- To go live: create `launcher/` next to `downloads/` in the website root on enderphone-prod
  (check the `enderphone.cloud` block in Caddy for the real root; the site is
  `/opt/enderphone-api/site`). Put `latest.yml`, `Ender Launcher Setup <version>.exe` and its
  `.blockmap` in it. Upload `latest.yml` **last**, so no client sees it before the installer is
  there.
- **Bump `version` in `launcher/package.json` for every release.** The updater compares versions,
  so every build so far (all `0.1.0`) looks like the same release. The release tag carries the
  version and run number.
- Add a download button on the website when the owner is happy with it. That's a `site/` change,
  deployed like the other site changes.

## 8. Still open (owner's call)

- **Merge PR #2** after §6 passes.
- **Code signing**: builds are unsigned, so SmartScreen warns on first run. This needs a
  certificate (OV or EV); electron-builder takes it via `CSC_LINK`/`CSC_KEY_PASSWORD` as GitHub
  secrets.
- **Own repo**: done - `launcher/` moved to `Scwunge/elauncher` and became a submodule
  like the others. Move the workflow with it.
- **Bundled JRE** (`resources/jre-win-x64`) for a faster first launch. Optional: Java downloads on
  the first Play anyway.
- The elytra decision in §5c.

## 9. Report back

- The API test run, the deploy line with backups, and the `/v1/launcher/releases` output (first
  entries).
- §5b and §6: pass or fail per step, with a screenshot of the Wardrobe cape and the same cape in
  game (F5) side by side, and the same for the elytra.
- Every fix pushed (commit and one line each), and any `EnderPhone` WARN/ERROR lines from
  `latest.log`.
- The owner's answer on §5c.
