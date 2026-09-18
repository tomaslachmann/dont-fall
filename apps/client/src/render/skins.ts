import { skinById, type SkinDef } from "@dont-fall/shared";
import * as THREE from "three";
import { skinTextureUrl } from "../lib/skinAssets.js";
import { paintModel, tintModel } from "./playerTint.js";

/** Loads one skin's body texture. Injected in tests, which never touch the network. */
export type LoadSkinTexture = (url: string) => Promise<THREE.Texture>;

const loadWithTextureLoader: LoadSkinTexture = (url) => new THREE.TextureLoader().loadAsync(url);

/**
 * Readies a freshly loaded body texture for BLIP's UV map: sRGB, because the
 * PNGs are authored as base color, and `flipY = false`, because glTF UVs
 * start at the top-left while three's texture default starts at the bottom.
 * Both differ from the loader's defaults, so this always marks the texture
 * dirty.
 */
export const prepareSkinTexture = (texture: THREE.Texture): THREE.Texture => {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
};

/**
 * Dresses a rig's body (ADR 0091). One per renderer: the match's Stage has
 * one, each Character preview has its own — the same shape as the hat
 * {@link Wardrobe}, and for the same reasons.
 *
 * A bean's body has exactly one look, and this owns it. A skin paints the
 * whole body with authored art; with no skin the body wears its flat color.
 * They are one call rather than two layers because both write the same
 * material, and two writers would race: a color arriving after a skin would
 * silently wipe it.
 *
 * - **Loaded once, worn many times.** Each skin's texture is fetched the
 *   first time anyone wears it, and every rig wearing it shares that one
 *   texture. At 2048², an uncompressed skin costs ~21 MiB of GPU memory, so
 *   "only what is worn" is a memory rule, not just a latency one.
 * - **The latest choice wins.** A skin still loading goes on only if it is
 *   still what that rig should wear when it arrives.
 * - **Anything that isn't a skin is no skin**, and so is a skin whose
 *   texture failed to load. The body falls back to its color, never to
 *   nothing.
 * - **A rig copied from a dressed rig** (`SkeletonUtils.clone`) copies its
 *   body material, and with it someone else's look. Its first `wear` writes
 *   this rig's own color at once, so it never shows another player's skin
 *   while its own loads.
 */
export interface SkinCloset {
  /**
   * Dresses `rig`'s body in `skin` (an id from shared's `SKINS`), or in
   * `hue` when `skin` is `null` — the hue being {@link tintHueForColor} of
   * the Player's equipped color, with `null` for BLIP's own cream. Cheap to
   * repeat: only a change that shows reaches the rig, since restyling clones
   * every material.
   */
  wear: (rig: THREE.Object3D, skin: string | null, hue: number | null) => void;
  /** Frees every loaded texture. Skins still loading never go on after this. */
  dispose: () => void;
}

export interface SkinClosetOptions {
  load?: LoadSkinTexture;
}

/** What a rig should be wearing — kept per rig so a slow load can tell whether it is still wanted. */
interface WantedLook {
  skin: string | null;
  hue: number | null;
}

export const createSkinCloset = ({ load = loadWithTextureLoader }: SkinClosetOptions = {}): SkinCloset => {
  const textures = new Map<string, Promise<THREE.Texture | null>>();
  const wanted = new WeakMap<THREE.Object3D, WantedLook>();
  let disposed = false;

  const textureFor = (skin: SkinDef): Promise<THREE.Texture | null> => {
    let texture = textures.get(skin.id);
    if (!texture) {
      texture = load(skinTextureUrl(skin.id))
        .then(prepareSkinTexture)
        .catch((err: unknown) => {
          console.warn(`Skin "${skin.id}" could not be loaded; worn as no skin`, err);
          return null;
        });
      textures.set(skin.id, texture);
    }
    return texture;
  };

  return {
    wear: (rig, id, hue) => {
      if (disposed) return;
      const skin = skinById(id);
      const next = skin?.id ?? null;
      const previous = wanted.get(rig);
      wanted.set(rig, { skin: next, hue });
      // A hue change under a skin changes nothing visible — but it is still
      // recorded above, so taking the skin off later reveals the right color.
      if (previous && previous.skin === next && (next !== null || previous.hue === hue)) return;
      if (!skin) {
        tintModel(rig, hue);
        return;
      }
      // First dressing of a rig cloned from a dressed one: write this rig's
      // own color now rather than letting it wear the source's skin until
      // this one arrives.
      if (!previous) tintModel(rig, hue);
      void textureFor(skin).then((texture) => {
        if (disposed || wanted.get(rig)?.skin !== skin.id) return;
        if (texture) paintModel(rig, texture);
        else tintModel(rig, hue);
      });
    },
    dispose: () => {
      disposed = true;
      for (const texture of textures.values()) {
        void texture.then((loaded) => loaded?.dispose());
      }
      textures.clear();
    },
  };
};
