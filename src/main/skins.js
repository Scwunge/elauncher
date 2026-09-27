const PROFILE_API = "https://api.minecraftservices.com/minecraft/profile";
function readPngDimensions(data) {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("That file is not a PNG image.");
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
function assertValidSkinDimensions(width, height) {
  if (width !== 64 || height !== 64 && height !== 32) {
    throw new Error(
      `That image is ${width}x${height} - Minecraft skins must be 64x64 (or the legacy 64x32).`
    );
  }
}
export async function uploadSkin(accessToken, data, variant) {
  const { width, height } = readPngDimensions(data);
  assertValidSkinDimensions(width, height);
  const form = new FormData();
  form.set("variant", variant);
  form.set("file", new Blob([data], { type: "image/png" }), "skin.png");
  const res = await fetch(PROFILE_API + "/skins", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Mojang rejected the skin upload (${res.status} ${res.statusText})${detail ? `: ${detail}` : "."}`
    );
  }
}
export async function fetchActiveSkinUrl(accessToken) {
  const res = await fetch(PROFILE_API, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return void 0;
  const profile = await res.json();
  const url = profile.skins?.find((s) => s.state === "ACTIVE")?.url;
  // Same plain-http quirk as toProfile() in auth.js - coerce to https rather than let the CSP
  // silently eat it.
  return url?.replace(/^http:/, "https:");
}
