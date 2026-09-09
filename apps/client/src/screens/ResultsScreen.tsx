import type { ResultsRow } from "@dont-fall/shared";
import { Button, LiveOverlay, Panel, Row } from "@dont-fall/ui";
import styles from "./ResultsScreen.module.css";

export interface ResultsScreenProps {
  results: ResultsRow[];
  /** Only the host's `returnToLobby` is honored server-side (M4 ticket 08) — mirrors `LobbyScreen`'s own host/guest split. */
  isHost: boolean;
  onReturnToLobby: () => void;
  /**
   * Whether this Match has more Rounds scheduled after this one (M7 ticket
   * 04, ADR 0049) — while true, `returnToLobby` is a Match-end action the
   * server silently refuses (`lobby.ts`), and the actual Standings Screen
   * (ticket 06) is what this Screen is a placeholder for. Defaults `false`
   * so every pre-M7 caller keeps rendering exactly what it always has.
   */
  roundsRemaining?: boolean;
}

/** `#1`/`#2`/`#3` get a medal color class; everyone else just gets the plain number (design-system.md §1.1's ranking role). */
const placementClass = (placement: number): string | undefined =>
  placement === 1 ? styles.gold : placement === 2 ? styles.silver : placement === 3 ? styles.bronze : undefined;

const progressLabel = (row: ResultsRow): string => {
  if (row.dnf) return "Left early";
  if (row.checkpointIndex === null) return "Did not reach a Checkpoint";
  return `Checkpoint ${row.checkpointIndex + 1}`;
};

/**
 * The Results Screen (M4 ticket 08, CONTEXT.md "Results") — the same "content
 * over a live scene" overlay shape `LobbyScreen` uses, shown while
 * `phase === "RESULTS"`. `results` is already fully ranked (`buildResults`,
 * `packages/shared`): Qualified by finish order, then everyone else by Track
 * progress, then DNFs last.
 */
export function ResultsScreen({ results, isHost, onReturnToLobby, roundsRemaining = false }: ResultsScreenProps) {
  return (
    <LiveOverlay isSceneLive={false}>
      <div className={styles.results}>
        <h1 className={styles.title}>Results</h1>

        <Panel className={styles.column}>
          {results.map((row, index) => (
            <Row
              key={row.id}
              variant={row.dnf ? "dnf" : "default"}
              enterIndex={index}
              leading={
                row.placement !== null && (
                  <span className={[styles.placement, placementClass(row.placement)].filter(Boolean).join(" ")}>
                    #{row.placement}
                  </span>
                )
              }
              label={row.nickname}
              trailing={
                <span className={styles.stats}>
                  {!row.qualified && <span className={styles.progress}>{progressLabel(row)}</span>}
                  <span className={styles.falls}>
                    {row.fallCount} {row.fallCount === 1 ? "fall" : "falls"}
                  </span>
                </span>
              }
            />
          ))}
        </Panel>

        {roundsRemaining ? (
          // The server auto-advances into the next Round on its own once
          // it's ready (ADR 0049) — a "Back to Lobby" click here is
          // silently refused (`lobby.ts`: Match-end only), so there is
          // nothing for either the host or anyone else to press. The real
          // Standings Screen (ticket 06) replaces this placeholder message.
          <p className={styles.hint}>More Rounds to play — advancing automatically…</p>
        ) : isHost ? (
          <Button onClick={onReturnToLobby}>Back to Lobby</Button>
        ) : (
          <p className={styles.hint}>Waiting for the host to return to the Lobby…</p>
        )}
      </div>
    </LiveOverlay>
  );
}
