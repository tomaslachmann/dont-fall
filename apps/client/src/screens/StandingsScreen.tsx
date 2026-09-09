import type { MatchWinner, ResultsRow } from "@dont-fall/shared";
import { Button, ExtrudedText, LiveOverlay, Panel, Row } from "@dont-fall/ui";
import type { StandingsRow } from "../game/index.js";
import styles from "./StandingsScreen.module.css";

export interface StandingsScreenProps {
  /** The Round just played, already ranked (`buildResults`, `packages/shared`) — identical shape to the pre-M7 Results Screen. */
  results: ResultsRow[];
  /** This Match's running total per Player, already tie-ranked and sorted (`game/index.ts` — never recomputed here, see the module docstring below). */
  standings: StandingsRow[];
  /** Whoever has the highest total once the Match ends (`matchWinner`) — empty while `roundsRemaining`, length > 1 on a genuine tie. */
  winners: MatchWinner[];
  /** Whether this Match has more Rounds after this one (M7 ticket 04, ADR 0049) — while true, the server auto-advances and there is nothing to click. */
  roundsRemaining: boolean;
  /** Only the host's `returnToLobby` is honored server-side, and only once no Rounds remain — mirrors `LobbyScreen`'s own host/guest split. */
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

const winnerLabel = (winners: MatchWinner[], standings: StandingsRow[]): string => {
  const nameOf = (id: string): string => standings.find((row) => row.id === id)?.nickname ?? id;
  if (winners.length === 0) return "";
  if (winners.length === 1) return `${nameOf(winners[0]!.id)} wins the Match!`;
  return `${winners.map((w) => nameOf(w.id)).join(" & ")} tie for the win!`;
};

/**
 * The Standings Screen (M7 ticket 06, ADR 0049) — the Screen between Rounds
 * and at the end of a Match, shown while `phase === "RESULTS"`. Absorbs the
 * pre-M7 Results Screen's own ranked-list panel (the Round just played)
 * rather than showing the same table on two Screens, and adds a second
 * panel for the Match's running Score (`standings`, computed client-side
 * from the replicated `roundResults` — `matchScore`, `packages/shared`).
 *
 * One component renders both states this Screen ever shows: between Rounds
 * (`roundsRemaining`, no winner, no action — the server advances on its
 * own once the next Track has loaded) and Match end (`!roundsRemaining`,
 * `winners` populated, host gets "Back to Lobby").
 */
export function StandingsScreen({
  results,
  standings,
  winners,
  roundsRemaining,
  isHost,
  onReturnToLobby,
}: StandingsScreenProps) {
  return (
    <LiveOverlay isSceneLive={false}>
      <div className={styles.standings}>
        <h1 className={styles.title}>{roundsRemaining ? "Standings" : "Final Standings"}</h1>

        {!roundsRemaining && winners.length > 0 && (
          <ExtrudedText
            className={styles.winner}
            color="var(--df-color-go)"
            depthColor="var(--df-color-go-depth)"
          >
            {winnerLabel(winners, standings)}
          </ExtrudedText>
        )}

        <Panel className={styles.column}>
          <h2 className={styles.sectionTitle}>This Round</h2>
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

        <Panel className={styles.column}>
          <h2 className={styles.sectionTitle}>Match Score</h2>
          {standings.map((row, index) => (
            <Row
              key={row.id}
              variant={row.gone ? "dnf" : "default"}
              enterIndex={index}
              leading={
                <span className={[styles.placement, placementClass(row.placement)].filter(Boolean).join(" ")}>
                  #{row.placement}
                </span>
              }
              label={row.nickname}
              trailing={
                <span className={styles.stats}>
                  {row.gone && <span className={styles.progress}>Left the Match</span>}
                  <span className={styles.score}>{Math.round(row.score)}</span>
                </span>
              }
            />
          ))}
        </Panel>

        {roundsRemaining ? (
          // The server auto-advances into the next Round on its own once
          // the next Track has loaded (ADR 0049) — a "Back to Lobby" click
          // here is silently refused (`lobby.ts`: Match-end only), so
          // there is nothing for either the host or anyone else to press.
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
