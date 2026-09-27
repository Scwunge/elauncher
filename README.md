# E-Launcher (Ender Launcher)

The Minecraft launcher built around EnderPhone. Electron + React.

Built from the CobbleGenerations launcher (`Scwunge/cobblegenerations-launcher` 0.4.3). Its engine
came across as-is: Microsoft sign-in (msmc), game and loader installs (@xmcl, Fabric/Forge/NeoForge/
Quilt), Java detection and Temurin download, Modrinth packs and content, skin upload and editor,
theming, the console, groups and per-instance launch settings. Everything CobbleGenerations-only was
removed (the official pack feed, Our Mods, the Unlocked tab and its videos/ROMs/GBA emulator,
Terraria, the admin panel). The UI was rebuilt in EnderPhone's own look.

## What it does that the old launcher didn't

| | |
|---|---|
| **EnderPhone in any instance** | One switch per instance. E-Launcher picks the right jar for its Minecraft version and loader, installs it, adds Fabric API on Fabric, swaps editions (EnderPhone / Lite), and updates it every time you press Play. A jar you turned off in Content stays off. |
| **New EnderPhone instance** | Pick a version EnderPhone is actually built for, a loader, an edition and extras (Sodium, Iris), and everything's downloaded in one go. |
| **EnderNet account** | Signs in to the EnderPhone API the same way the phone does (Mojang `joinServer` handshake), including the EnderPhone password prompt for accounts that set one. The password is never stored. |
| **Servers (Endportal)** | The server list with live counts, votes and ratings. **Join** launches an instance straight into the server with Quick Play. |
| **EnderNet pages** | EnderChat, Enderbook, Endportal, Sites, Hosting and Account, embedded and already signed in. |
| **Friends and network** | Friends online (accept or decline requests) and relay status in the sidebar; players online, calls, voice rooms and the radio on Home. |
| **Wardrobe** | Skin and your EnderPhone cape (PNG or animated GIF) on one 3D preview, with a cape/elytra toggle. |
| **Worlds and Logs** | Per instance: worlds with Play-into-world, and `latest.log` with warning/error filtering. |
| **Themes** | The phone's six themes (End, Midnight, Nether, Grove, Deep, Rose), plus every colour and a background image. |

## Where EnderPhone jars come from

`GET https://api.enderphone.cloud/v1/launcher/releases`: a listing of `enderphone.cloud/downloads/`
with a sha1 per jar (added to `enderphone-api` alongside this launcher; see its README). Uploading a
jar publishes it. Downloads go through the API's `/v1/dl/` counter, so launcher installs count on the
website's download total. Every download is sha1-checked before it replaces anything.

If the feed can't be reached, the last good copy is used. With no copy at all, the launcher falls
back to the website's own rule: the fixed file name for `KNOWN_VERSION` (in
`src/main/enderphone-mod.js`), checked with a HEAD request. Bump `KNOWN_VERSION` with each release.

## Development

```bash
npm install
npm run dev          # electron-vite dev, hot reload
npm run typecheck
npm run lint
npm test             # node --test: EnderPhone install rules against a local HTTP server, Quick Play
npm run build        # main + preload + renderer to out/
npm run build:win    # + NSIS installer and portable exe
npm run build:linux  # AppImage
npm run build:mac    # dmg
```

Set `ENDERPHONE_API_BASE` (see `.env.example`) to point a dev build at a local `enderphone-api`.

## Layout

| Path | What |
|---|---|
| `src/main/enderphone-api.js` | EnderNet client: the sign-in handshake, the token, every API call |
| `src/main/enderphone-mod.js` | The release feed and EnderPhone install/update/remove in an instance |
| `src/main/ipc.js` | Every IPC handler; `play:start` updates EnderPhone before launching |
| `src/main/minecraft.js` | Game and loader install, launch, Quick Play arguments |
| `src/main/index.js` | Window, and the locked-down `<webview>` for EnderNet pages (own partition, no Node, API origin only) |
| `src/renderer/src/state.tsx` | Launch state and EnderNet state shared across pages |
| `src/renderer/src/components/` | One file per page and dialog |
| `src/renderer/src/ender.css` | E-Launcher's styles, over the base `index.css` |

## Not done yet

- **Auto-update hosting.** `electron-updater` points at `https://enderphone.cloud/launcher`. Nothing
  is published there yet; upload `latest.yml` and the installer from `release/` after a build.
- **Code signing.** Windows builds are unsigned, so SmartScreen warns on first run.
- **A bundled JRE** (`resources/jre-win-x64`) for instant first launch. Optional: Java is downloaded
  on the first Play anyway.
- **Tested outside Electron only.** Typecheck, lint, build and the unit tests pass, and every page
  was screenshotted against a mocked backend. A real Microsoft sign-in, game launch and EnderNet
  handshake still need a run on a desktop.
