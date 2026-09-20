/**
 * The voice relay worker's entry point (ADR 0111), and the only file in this
 * service Node loads with nothing in front of it.
 *
 * A `worker_thread` does **not** inherit the parent thread's module hooks:
 * Node's loader customizations are per-thread, and `execArgv` is ignored for
 * the ones that install them. So a worker started on a `.ts` file would be
 * type-stripped by Node and then fail on the first `./x.js` specifier this
 * repo writes (TypeScript's `nodenext` convention, where the file on disk is
 * `./x.ts`).
 *
 * Hence this file: plain JavaScript, no compile step, which registers `tsx`
 * — the same loader `pnpm start` runs the service under — and only then
 * imports the relay. It is deliberately the whole of the bootstrap; every
 * line of the relay itself is TypeScript beside the rest of the service.
 */
import { register } from "tsx/esm/api";

register();
await import("./voiceRelay.ts");
