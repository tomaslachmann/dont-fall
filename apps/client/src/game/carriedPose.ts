import { mulQuat, type PropSnapshot, type RenderCharacter, type Vec3 } from "@dont-fall/shared";

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
  return { ...held, position: rebased(held.position, grabberOnServer, grabberDrawn, turned), facing: held.facing + turned };
};

/**
 * `at`, relative to the grabber in the server's world, hung off the grabber
 * as drawn and turned by however far it has turned since. `facing` turns
 * forward(f) = (sin f, −cos f) into forward(f + d): in the x–z plane that is
 * the ordinary rotation by d.
 */
const rebased = (
  at: Vec3,
  grabberOnServer: { position: Vec3 },
  grabberDrawn: { position: Vec3 },
  turned: number,
): Vec3 => {
  const cos = Math.cos(turned);
  const sin = Math.sin(turned);
  const x = at.x - grabberOnServer.position.x;
  const z = at.z - grabberOnServer.position.z;
  return {
    x: grabberDrawn.position.x + x * cos - z * sin,
    y: grabberDrawn.position.y + (at.y - grabberOnServer.position.y),
    z: grabberDrawn.position.z + x * sin + z * cos,
  };
};

/**
 * Where to draw a Prop this client's own Character carries (ADR 0125): the
 * same rebasing as {@link carriedPose}, with the Prop's rotation turned along.
 * Its position is only a first guess since ADR 0128: `Stage.holdCarriedProps`
 * then puts the Prop in the hands as the rig has them, keeping this rotation.
 */
export const carriedPropPose = (
  prop: PropSnapshot,
  grabberOnServer: { position: Vec3; facing: number },
  grabberDrawn: { position: Vec3; facing: number },
): PropSnapshot => {
  const turned = grabberDrawn.facing - grabberOnServer.facing;
  // A turn of `turned` in facing is a turn of −turned about +Y (forward is (sin f, 0, −cos f)).
  const yaw = { x: 0, y: Math.sin(-turned / 2), z: 0, w: Math.cos(-turned / 2) };
  return {
    ...prop,
    position: rebased(prop.position, grabberOnServer, grabberDrawn, turned),
    rotation: mulQuat(yaw, prop.rotation),
  };
};
