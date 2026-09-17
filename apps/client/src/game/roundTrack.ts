/**
 * Which Track the game must actually have loaded, and when that has to change.
 *
 * The `welcome` (ADR 0024) names the Track the Match server held when this
 * socket opened — which, on a shell-owned Lobby connection (ADR 0056), is
 * long before the Round starts. A host's Track pick, and every Round a Match
 * draws after its first, move the server's world on without a second
 * `welcome`. Booting on the welcome's Track, or reloading only while the
 * phase still reads LOBBY, leaves the client drawing one Track while the
 * server simulates another: Characters stand inside scenery that isn't where
 * they are, and never fall, because on the server they are on solid ground.
 */
export interface TrackRef {
  trackId: string;
  trackRevision: number;
}

/**
 * The Track a booting game must load: whatever the Match is on *now* (the
 * shell's latest snapshot), falling back to the welcome's own when no
 * snapshot has arrived yet (a game that dialed its own socket).
 */
export const bootTrackRef = (welcome: TrackRef, current: TrackRef | null | undefined): TrackRef =>
  current === null || current === undefined ? { ...welcome } : { ...current };

/**
 * Whether a snapshot's Track is not the one this client has loaded — in any
 * phase, deliberately: a Match's later Rounds change Track inside COUNTDOWN,
 * never through the Lobby (M7 ticket 04). A reload already in flight answers
 * `false`; it is loading the answer.
 */
export const needsTrackReload = (loaded: TrackRef, snapshot: TrackRef, reloadInFlight: boolean): boolean =>
  !reloadInFlight && (snapshot.trackId !== loaded.trackId || snapshot.trackRevision !== loaded.trackRevision);
