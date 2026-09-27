# Handoff: build and finish E-Launcher (for the local AI)

**Read this first.** Then read `handoff/2026-09-27-e-launcher.md` for the full detail. That older
handoff was written while the launcher lived at `launcher/` inside the umbrella repo; everything here
supersedes it where they differ.

## Where everything is now

- **This repo, `Scwunge/elauncher`, is the launcher.** Its full history moved here from the
  `enderphone` umbrella, where it was `launcher/` on branch `claude/determined-shannon-o1hk9t`.
  - That umbrella branch now has `launcher/` as a submodule pointing here (`a94b08c`).
  - PR https://github.com/Scwunge/enderphone/pull/2 still exists. Merge it when the owner is happy;
    it no longer carries launcher code itself.
- **Windows build:** `.github/workflows/build.yml` runs on every push to `master`. It typechecks,
  tests, builds the installer and portable exe, and publishes them as a prerelease:
  https://github.com/Scwunge/elauncher/releases. Builds 1 and 2 passed.
- **The API side is `enderphone-api`, branch `claude/sharp-ptolemy-launcher-api`** (`668c755`).
  **Use this branch, not the api's `claude/determined-shannon-o1hk9t`.** The old one forks from before
  the EnderChat rewrite and conflicts with master.
  - The new branch is current master (`bf37a98`, which already has EnderChat) plus two commits:
    - `33c80c0`: the release feed, `GET /v1/launcher/releases` (cherry-pick of `329be66`).
    - `668c755`: EnderChat chat links (`c=`, `dm=`) and taking a fresh token, ported onto the new
      page.
  - It merges into master as a fast-forward.

## Done in the cloud (2026-09-27)

- **Cape fix.** The Wardrobe didn't show your saved cape, because the live `/cdn/*` is served by
  Caddy with no `Access-Control-Allow-Origin`, so the page's `fetch()` was refused. The main
  process now downloads it instead (`src/main/cape-download.js`, IPC `endernet:capeImage`), and
  `test/cape-download.test.mjs` covers it. Commit `4da74cb`.
- **In game, capes work.** I checked in a real 1.21.1 NeoForge client with EnderPhone Lite against a
  local API: a supporter-tier player's cape drew on their back within about 4 s. If the owner still
  can't see theirs in game, check:
  - Their supporter tier hasn't lapsed. `capeUrl` hides the cape when it has, see §5a of the old
    handoff.
  - `couldn't load cape` in `latest.log`. A failed cape download isn't retried until the game
    restarts.
  - Another ATM10 mod that also changes the player's cape.
  - The phone's "show capes" setting, and Minecraft's Skin Customization → Cape.
- **Chat links.** A `dm=` link to someone new now opens a **draft** DM: nothing is sent until the
  player writes something (the old page sent a 👋). The integration test was updated to match
  (`2eccc67`).
- **Test results:**
  - Launcher: `npm test` 43/43; typecheck, lint and build clean.
  - Launcher integration, against the new API branch: 10/10.
  - API: `bash run-tests.sh` ALL PASSED, and `test-enderchat-browser.cjs` passes.

## What's left for you, in order

1. **Pull.** Clone `Scwunge/elauncher` (e.g. `C:\Users\conne\Documents\elauncher`) and check out
   `enderphone-api` branch `claude/sharp-ptolemy-launcher-api`.
2. (Nothing to push: everything from the cloud is on GitHub.)
3. **Deploy the API (needs the owner's go-ahead).**
   - Run `bash run-tests.sh`; expect ALL PASSED.
   - Fast-forward master to `668c755`, push, and deploy the usual way (backups, restart, health
     check).
   - Changed files: `server.mjs`, `lib/releases.mjs`, `lib/public-status.mjs`,
     `pages/enderchat.html`, `test-releases.mjs`, `run-tests.sh`.
   - Check that `curl.exe -s https://api.enderphone.cloud/v1/launcher/releases` lists the jars.
   - **Master also holds the EnderChat rewrite (`6db2d7a`, `4367e2f`).** If that isn't deployed
     yet, it goes out in the same deploy. It adds DB columns and tables on boot, so back up
     `data/enderphone.sqlite` first. `/v1/stream` must pass through Caddy unbuffered; see
     `handoff/2026-09-27-enderchat.md` in the umbrella.
4. **Optional server tidy-up.** Add `header Access-Control-Allow-Origin *` to the `/cdn/*` block in
   `enderphone-api/gen-deploy.py`. The launcher no longer needs it, but web pages would.
5. **First real run on Windows.** Follow §6 of the old handoff:
   - `npm install`, `npm test`, `npm run dev`, or install the latest release exe.
   - Microsoft sign-in, EnderNet connect, a new EnderPhone instance, and Play, on both Fabric and
     NeoForge.
   - Servers/Join, Worlds, Logs.
   - The EnderChat tab and notifications.
   - The EnderNet tab.
   - The online setting.
   - **Wardrobe** (§5b): the saved cape must now show. Compare it side by side with the game in F5.
6. **Fix whatever breaks.** Commit to this repo's `master`; each push builds a new release.
   Likely weak spots, never run for real:
   - msmc's sign-in popup in a packaged build.
   - NeoForge installs on 26.x.
   - The `<webview>` lockdown.
   - Desktop notifications (test with the installed build).
   - The auto-updater.
7. **Release hosting (§7 of the old handoff).**
   - Bump `version` in `package.json` for every release; all builds so far say 0.1.0.
   - Host `latest.yml`, the installer and the `.blockmap` under `enderphone.cloud/launcher/`.
     Upload `latest.yml` last.
   - Bump `KNOWN_VERSION` in `src/main/enderphone-mod.js` with every mod release.
8. **Owner's calls:**
   - Code signing.
   - Elytra thickness (§5c of the old handoff): the preview draws wings at half depth, but the game
     is vanilla.
   - A bundled JRE.
   - A download button on the website.
   - Merging PR #2 in the umbrella.

## Report back

- The API test run and the deploy line.
- Pass or fail for each step of §6 and §5b, with screenshots of the Wardrobe cape next to the same
  cape in game.
- Every fix you pushed (commit and one line each).
- The owner's answers on step 8.
