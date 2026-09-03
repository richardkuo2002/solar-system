// Pure (no THREE/DOM) piece of the texture-loading logic — kept separate
// from render/texture-loader.js so it stays directly Node-testable, per
// this project's core/-vs-render/ split.

/**
 * Does a real downloaded file exist for this texture path, per the
 * manifest written by scripts/fetch-textures.mjs (keyed by filename, e.g.
 * "2k_earth_daymap.jpg")? False means the caller should use the procedural
 * fallback (src/render/procedural-textures.js) instead of attempting a
 * network request that would just 404.
 */
export function hasRealTextureFile(manifest, texturePath) {
  if (!texturePath) return false;
  const filename = texturePath.slice(texturePath.lastIndexOf('/') + 1);
  return Boolean(manifest && manifest[filename]);
}
