import type { ResultsRow } from "@dont-fall/shared";
import { Button, LiveOverlay, Panel, Row } from "@dont-fall/ui";
import styles from "./ResultsScreen.module.css";

export interface ResultsScreenProps {
  results: ResultsRow[];
  /** Only the host's `returnToLobby` is honored server-side (M4 ticket 08) — mirrors `LobbyScreen`'s own host/guest split. */
  isHost: boolean;
  onReturnToLobby: () => void;
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
export function ResultsScreen({ results, isHost, onReturnToLobby }: ResultsScreenProps) {
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

        {isHost ? (
          <Button onClick={onReturnToLobby}>Back to Lobby</Button>
        ) : (
          <p className={styles.hint}>Waiting for the host to return to the Lobby…</p>
        )}
      </div>
    </LiveOverlay>
  );
}
