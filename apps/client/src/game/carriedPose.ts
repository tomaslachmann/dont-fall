import type { RenderCharacter, Vec3 } from "@dont-fall/shared";

/**
 * Where to draw a Character this client's own Character is carrying (ADR
 * 0104): in the grabber's hands as they are *drawn*, not where the server's
 * interpolated world has the body.
 *
 * The two are a round trip and the interpolation delay apart. The grabber is
 * predicted, ahead of the server; everyone else, the body in its hands
 * included, is drawn from the server's past. Drawn as it is, the body trails
 * the grabber's hands — during a full Spin by 60–80°. The fix is the one fact
 * both worlds agree on: where the body sits *relative to its grabber*. Taken
 * off the server's world (same instant, so no lag between them), turned by
 * however far the drawn grabber has turned since, and hung off the drawn
 * grabber. On every other client both ends are drawn from the same server
 * world, so this is only ever needed on the grabber's own.
 */
export const carriedPose = (
  held: RenderCharacter,
  grabberOnServer: { position: Vec3; facing: number },
  grabberDrawn: { position: Vec3; facing: number },
): RenderCharacter => {
  const turned = grabberDrawn.facing - grabberOnServer.facing;
  const cos = Math.cos(turned);
  const sin = Math.sin(turned);
  // `facing` turns forward(f) = (sin f, −cos f) into forward(f + d): in the
  // x–z plane that is the ordinary rotation by d.
  const x = held.position.x - grabberOnServer.position.x;
  const z = held.position.z - grabberOnServer.position.z;
  return {
    ...held,
    position: {
      x: grabberDrawn.position.x + x * cos - z * sin,
      y: grabberDrawn.position.y + (held.position.y - grabberOnServer.position.y),
      z: grabberDrawn.position.z + x * sin + z * cos,
    },
    facing: held.facing + turned,
  };
};
