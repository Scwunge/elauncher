import * as msmc from 'msmc'
import { getPersistedAccount, setPersistedAccount } from './store.js'

let cachedSession;
function toProfile(minecraft) {
  const skin = minecraft.profile?.skins?.find((s) => s.state === "ACTIVE");
  return {
    id: minecraft.profile.id,
    name: minecraft.profile.name,
    // Mojang's session API still hands back plain "http://textures.minecraft.net/..." URLs even
    // though the CDN serves the identical texture over TLS - our CSP (img-src ... https: data:)
    // rightly blocks the http one outright, which silently broke every skin face in the app (nav
    // rail avatar, right sidebar, the 3D viewer). Coerce the scheme rather than loosen the CSP.
    skinUrl: skin?.url?.replace(/^http:/, "https:"),
    skinModel: skin?.variant === "SLIM" ? "slim" : "classic"
  };
}
function toSession(minecraft) {
  return { accessToken: minecraft.mcToken, profile: toProfile(minecraft) };
}
export async function signIn() {
  const authManager = new msmc.Auth("select_account");
  const xbox = await authManager.launch("electron", {
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    title: "Sign in to Minecraft"
  });
  const minecraft = await xbox.getMinecraft();
  const owns = await minecraft.entitlements().catch(() => []);
  if (!owns.includes("game_minecraft")) {
    throw new Error(
      "This Microsoft account does not appear to own Minecraft: Java Edition. Sign in with the account you purchased the game with."
    );
  }
  setPersistedAccount({
    msmcRefreshToken: xbox.save(),
    profile: toProfile(minecraft)
  });
  cachedSession = toSession(minecraft);
  return cachedSession;
}
export async function trySilentSignIn() {
  if (cachedSession) return cachedSession;
  const saved = getPersistedAccount();
  if (!saved) return void 0;
  try {
    const authManager = new msmc.Auth("select_account");
    const xbox = await authManager.refresh(saved.msmcRefreshToken);
    const minecraft = await xbox.getMinecraft();
    setPersistedAccount({ msmcRefreshToken: xbox.save(), profile: toProfile(minecraft) });
    cachedSession = toSession(minecraft);
    return cachedSession;
  } catch {
    setPersistedAccount(void 0);
    return void 0;
  }
}
export function signOut() {
  cachedSession = void 0;
  setPersistedAccount(void 0);
}
export function getCachedSession() {
  return cachedSession;
}
export function updateCachedSkinUrl(skinUrl, skinModel) {
  if (!cachedSession || !skinUrl) return;
  const patch = skinModel ? { skinUrl, skinModel } : { skinUrl };
  cachedSession = { ...cachedSession, profile: { ...cachedSession.profile, ...patch } };
  const saved = getPersistedAccount();
  if (saved) {
    setPersistedAccount({ ...saved, profile: { ...saved.profile, ...patch } });
  }
}
