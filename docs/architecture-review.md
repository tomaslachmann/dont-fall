# Architektonická revize — principal-engineer review

## 1. Shrnutí

Klient v `apps/client/src` je React + three.js front-end: vstupním bodem je `App.tsx:1`, který pouze routuje mezi `screens/` a herní cestou `/play`. Těžká herní logika žije v `game/`, `net/`, `render/`, `hud/` a `input/` a je odlehčena od menu dynamickým importem, který hlídá test `codeSplitBoundary.test.ts`. Sdílené jádro v `packages/shared` nese rapier3d-compat fyziku a simulační typy a konzumují ho všechny aplikace; jeho exportní povrch je ale širší, než jádro potřebuje. Směr závislostí je zdravý (`apps/* -> packages/shared`, server `-dev-> track-service`, klient `-> ui`), jen není strojově vynucený. Největší duplicitou je časovací smyčka: `advanceFixed` v shared duplikuje logiku akumulátoru v klientském `PredictionLoop`. Nejvyšší páku má proto oddělení simulace od renderu na klientovi, vyčištění exportů shared, uzamčení směru závislostí lintem a rozhodnutí o osudu `advanceFixed` / `FixedSimulation`.

## 2. Nálezy seřazené podle páky

### Nález 1 — Klient míchá simulační smyčku s React renderem

**Co:** `apps/client/src` je React + three.js front-end. Vstup `apps/client/src/App.tsx:1` importuje `react-router` a routuje `screens/MainMenuScreen` vs. `components/GameCanvas`; herní vrstvy jsou `game/`, `net/`, `render/`, `hud/`, `input/` (ověřeno výpisem `apps/client/src`). Deklarované závislosti `apps/client/package.json:1` (blok `dependencies` na řádcích 13–20) jsou `@dont-fall/shared`, `@dont-fall/ui`, `react`, `react-dom`, `react-router`, `three`.

**Kde:**

- `apps/client/src/App.tsx:1`
- `apps/client/src/screens/`, `apps/client/src/game/index.ts`, `apps/client/src/net/`, `apps/client/src/render/`, `apps/client/src/hud/`, `apps/client/src/input/`
- `apps/client/package.json:1` (závislosti řádky 13–20)
- Hranice splitu: `apps/client/src/codeSplitBoundary.test.ts:23` (`SHELL = ["App.tsx", "main.tsx", "screens", "components"]`), `apps/client/src/codeSplitBoundary.test.ts:26` (`GAME = ["game", "render", "net", "hud", "input"]`)

**Proč to bolí:** `game/index.ts` (řádky 1–50: importuje zároveň `@dont-fall/shared`, `../render/*`, `../hud/*`, `../input/*`, `../net/*`, `../lib/*`) je centrální spojka, přes kterou se simulační krok, predikce, scéna, HUD a vstup svazují do jednoho modulu. Každá změna herní smyčky tak tahá React/render závislosti a naopak. Test hranice to dnes pouze hlídá negativně (žádný statický import shell → game), ale adresářová struktura „podle druhu" (komentář `codeSplitBoundary.test.ts:15–18`: „M4.5 ticket 08 organised this package by kind rather than by that boundary") hranici sama neukazuje — nová složka nutí k ručnímu rozhodnutí, na kterou stranu patří.

**Konkrétní návrh:** Ponechat test jako strážce a fyzicky rozdělit `GAME` stranu na `game/sim/` (čistá simulace + predikce nad `@dont-fall/shared`, bez three/React importů) a `game/render/` (three.js scéna, HUD, vstup). Shell (`App.tsx`, `screens/`, `components/GameCanvas`) smí `sim` i `render` tahat pouze přes dynamický `import()` (dnes povolený vzor dle `codeSplitBoundary.test.ts:136–142`), nikdy statickým value-importem. Přidání nové složky = jeden řádek do `SHELL`/`GAME` v testu, jinak test padne.

### Nález 2 — Shared balíček exportuje klientské artefakty

**Co:** `packages/shared` je rapier3d-compat fyzikální jádro sdílené všemi aplikacemi. `packages/shared/src/index.ts:1–43` re-exportuje `math/`, `state/`, `input/`, `timing/`, `match/`, `simulation/`, `track/`, `net/protocol.js`; `packages/shared/package.json:21–23` deklaruje jedinou runtime závislost `@dimforge/rapier3d-compat`. Vedle toho ale exportuje i `packages/shared/package.json:10` (`"./design/tokens.css": "./src/design/tokens.css"`, soubor `packages/shared/src/design/tokens.css`) a `packages/shared/package.json:11` (`"./playground.js": "./src/playground.ts"`, soubor `packages/shared/src/playground.ts`).

**Kde:**

- `packages/shared/src/index.ts:1`
- `packages/shared/src/playground.ts`
- `packages/shared/src/design/tokens.css`
- `packages/shared/package.json:1` (exporty řádky 8–12, závislost řádky 21–23)

**Proč to bolí:** Design-tokeny (CSS) a playground jsou klientské / vývojové artefakty, ne fyzikální jádro. Každý konzument `shared` (server včetně) si je tahá do výhledu závislostí; import CSS z fyzikálního balíčku na serveru je konceptuální chyba a zvětšuje povrch, který musí verzovat a auditovat všechny aplikace. `main`/`types` (`packages/shared/package.json:6–7`) ukazují na `src/index.ts`, takže se nechtěný povrch tváří jako rovnocenná součást API.

**Konkrétní návrh:** Odebrat oba subpath-exporty ze `shared`: `./design/tokens.css` přesunout do `packages/ui` (vlastník design-systému, klient ho už závisí), `./playground.js` do client-only pomocného balíčku nebo přímo pod `apps/client` (případně `devDependencies` tooling). V `shared` ponechat pouze simulační jádro (`math`, `state`, `timing`, `match`, `simulation`, `track`, `net/protocol`, `tuning`). Jde o breaking změnu exportní mapy — po přesunu opravit importéry na novou cestu a vydat jako major/minor dle verzovací politiky monorepa.

### Nález 3 — Směr závislostí je správný, ale není vynucený

**Co:** Pozorovaný směr: `apps/* -> packages/shared` (klient i server deklarují `@dont-fall/shared` ve `workspace:*`), server `apps/server/package.json` má `@dont-fall/track-service` pouze v `devDependencies`, klient má `@dont-fall/ui` v `dependencies`. Opačná hrana `shared -> apps` nebyla pozorována (grep `from "@dont-fall` v `packages/shared/src` vrátil prázdný výsledek).

**Kde:**

- `apps/client/package.json:13–16` (`@dont-fall/shared`, `@dont-fall/ui`)
- `apps/server/package.json:14–22` (`dependencies`: `@dont-fall/shared`; `devDependencies`: `@dont-fall/track-service`)
- `packages/shared/src/` — žádný import `@dont-fall/*` (negativní nález)

**Proč to bolí:** Pravidlo dnes drží jen konvence a code-review. Jeden nepozorný import serverové logiky do `shared` (nebo sdíleného serverového helperu do klienta) projde buildem i testy a zlomí hranici autoritativní simulace vs. prezentace potichu — typ chyby, kterou odhalí až měření nebo produkční incident.

**Konkrétní návrh:** Vynutit strojově: `eslint` pravidlo `no-restricted-imports` (případně `eslint-plugin-import` / workspace dep-lint) se zákazem (a) jakéhokoliv importu `@dont-fall/server`, `@dont-fall/track-service`, `apps/*` z `packages/shared` a `packages/ui`, (b) importu serverových zdrojáků z `apps/client`, (c) value-importu shell → game nad rámec `codeSplitBoundary.test.ts`. Test hranice ponechat jako druhou vrstvu (bundle-level), lint jako první (module-level). Porušení = chyba buildu, ne varování.

### Nález 4 — Mrtvá / duplicitní větev pevného kroku (`advanceFixed` vs. `PredictionLoop`)

**Co:** `packages/shared/src/timing/advanceFixed.ts:50–81` implementuje generický akumulátor (`accumulatorMs + elapsedMs`, `EPSILON_MS` guard, `MAX_STEPS_PER_FRAME` clamp, zahození backlogu). Klientský `apps/client/src/net/predictionLoop.ts:26–27` definuje vlastní `EPSILON_MS = 1e-6` se stejným komentářem („mirrors `advanceFixed`'s own guard") a na řádcích `predictionLoop.ts:163–165` vlastní akumulátorovou smyčku (`Math.min(... TICK_MS * MAX_STEPS_PER_FRAME)`, `while (accumulatorMs + EPSILON_MS >= TICK_MS && steps < MAX_STEPS_PER_FRAME)`). Produkční smyčka v `apps/client/src/game/index.ts` na `advanceFixed` pouze odkazuje v komentářích (`game/index.ts:54`, `game/index.ts:329` — clamp `MAX_STEPS`), ale `advanceFixed`/`FixedSimulation` reálně pohání jen testy (`advanceFixed.test.ts`); `game/` a `net/` si nesou vlastní implementace. Kontrakt `FixedSimulation` (`packages/shared/src/timing/FixedSimulation.ts:6–11`: `tick(input)` + `snapshot()`) nemá v produkci volajícího.

**Kde:**

- `packages/shared/src/timing/advanceFixed.ts:50–81` (smyčka `acc + EPSILON_MS >= TICK_MS`, řádek 61; clamp řádky 68–72)
- `packages/shared/src/timing/advanceFixed.ts:5` (`EPSILON_MS = 1e-6`)
- `packages/shared/src/timing/FixedSimulation.ts:6`
- `apps/client/src/net/predictionLoop.ts:26` (duplicitní `EPSILON_MS`), `apps/client/src/net/predictionLoop.ts:163–165` (duplicitní smyčka)
- `apps/client/src/game/index.ts:54`, `apps/client/src/game/index.ts:329` (pouhé komentářové odkazy)

**Proč to bolí:** Dvě implementace téže časovací sémantiky (epsilon proti float-driftu, clamp proti spirále při backgrounded tabu) se budou rozcházet: oprava v jedné se neprojeví ve druhé a chování simulace se liší podle toho, kudy frame protekl. Mrtvý generický kód v `shared` navíc sugeruje API, které produkce nepoužívá, a mate nové přispěvatele.

**Konkrétní návrh:** Rozhodnout binárně, bez třetí „kompatibilní" varianty: (A) zobecnit `advanceFixed` tak, aby ho `PredictionLoop` (a ideálně i hlavní smyčka v `game/index.ts`) skutečně volal — tj. parametry pro reconcile/predikci, nebo (B) smazat `advanceFixed.ts` + `FixedSimulation.ts` (+ jejich testy) ze `shared` a ponechat jedinou implementaci v klientovi. Doporučuji (B), dokud se neprokáže druhý produkční konzument: méně kódu, jeden vlastník sémantiky. Do rozhodnutí nesahat na `roundClock.ts` ani ladicí konstanty v `tuning.js` (`TICK_MS`, `MAX_STEPS_PER_FRAME`), které obě větve sdílejí.

## 3. Navržená struktura složek (before / after)

Before (současný stav, zkráceno):

```text
apps/client/src/
  App.tsx            # shell: routing (react-router)
  main.tsx
  screens/           # shell (menu bundle)
  components/        # shell (GameCanvas = hranice dynamického importu)
  game/index.ts      # hra: sim + render + net + hud + input v jednom
  render/            # hra
  net/               # hra (predictionLoop, propPrediction, snapshotInterpolation…)
  hud/               # hra
  input/             # hra
  lib/               # neutrální pomocníci (connection, listeners, roundTimer, teardown)
packages/shared/src/
  index.ts           # re-export všeho simulačního
  math/ state/ input/ timing/ match/ simulation/ track/ net/ tuning.ts
  playground.ts      # NE — klientský artefakt v jádře
  design/tokens.css  # NE — design-systém v jádře
```

After (navržený stav):

```text
apps/client/src/
  App.tsx
  main.tsx
  screens/
  components/        # GameCanvas: jediný dynamický import() do game/
  game/
    sim/             # čistá simulace: krok, predikce, reconcile — jen @dont-fall/shared, žádný three/React
    render/          # three.js scéna, modely, kamery (přesun z render/)
    hud/             # přesun z hud/
    input/           # přesun z input/
    net/             # přesun z net/ — síťová část sim, bez renderu
  lib/               # neutrální, bez závislostí na sim ani render (hlídá test)
packages/shared/src/
  index.ts           # pouze simulační jádro
  math/ state/ input/ timing/ match/ simulation/ track/ net/ tuning.ts
packages/ui/
  design/tokens.css  # přesun z packages/shared/src/design/
apps/client/dev/  (nebo nový client-only balíček)
  playground.ts      # přesun z packages/shared/src/playground.ts
```

Migrace je přesun souborů + úprava importních cest + jeden řádek v `SHELL`/`GAME` mapách testu; žádné chování se nemění.

## 4. Reuse a polymorfismus (konkrétní kandidáti)

1. **Časovací smyčka (nejvyšší priorita).** Kandidáti: `advanceFixed` (`advanceFixed.ts:50`), `PredictionLoop` (`predictionLoop.ts:163–165`), komentovaná smyčka v `game/index.ts`. Polymorfní kontrakt už existuje (`FixedSimulation.tick/snapshot`, `FixedSimulation.ts:6–11`). Buď ho použít všude, nebo smazat (viz Nález 4, varianta B). Dva `EPSILON_MS` (`advanceFixed.ts:5`, `predictionLoop.ts:27`) musí mít jediný zdroj pravdy — dnes ideálně `tuning.js` vedle `TICK_MS`/`MAX_STEPS_PER_FRAME`.
2. **Interpolace snapshotů.** `packages/shared/src/state/interpolate.ts` (export `index.ts:7`) vs. klientský `SnapshotInterpolator` (`game/index.ts:48`) a `interpolateState` (`game/index.ts:17`). Kandidát na sjednocení: sdílená čistá funkce nad `SimState`, klient pouze volá. Ověřit, zda klientský interpolátor nedupluje sdílený — pokud ano, smazat klientskou kopii.
3. **Reconcile brána.** `simulation/reconcileGate.js` (`index.ts:35`: `needsCorrection`) vs. `PredictionLoop.reconcile` (`predictionLoop.ts:38–52`, konfigurovatelné prahy). Třída už je polymorfní přes `PredictionLoopConfig` (produkční defaults + harness-overrides pro `predictionRegression.harness.test.ts`). Držet jediný práh pravdy v `shared`, klient pouze konfiguruje — nerozšiřovat konfigurovatelnost bez nového produkčního případu.
4. **Vstupové směry.** `input/movementDirection.js` (`index.ts:9`) + `FreeLookCamera, KeyboardInput` (`game/index.ts:40`, `input/input.ts`) + kamerové helpery (`input/camera/`). Kandidát na čisté sdílené rozhraní vstup → `SimInputs` (`index.ts:19`), aby se klientský vstup dílil bez kopírování vektorové matematiky (`math/vec3.js`, `math/angle.js`, `math/quat.js`).
5. **Track moduly.** `track/Module.js`, `track/modules.js`, `track/Track.js` (`index.ts:39–42`), `resolveTrack`/`MODULE_LIBRARY` (`game/index.ts:22`, `game/index.ts:8`). Track-builder a server by měli konzumovat tentýž typ — ověřit, že `track-service` nedefinuje vlastní paralelní typ trati; pokud ano, sjednotit na `shared/track`.

## 5. Čeho se nedotýkat (platná ADR a jejich důvody)

- **ADR 0008 (React pro screens, hra za dynamickým importem).** `App.tsx:18–22`: „React owns routing, the game loop never runs through it." Test `codeSplitBoundary.test.ts` je její strojová podoba. Důvod: menu nesmí platit za three.js + Rapier WASM před klikem na Play. Nález 1 hranici zpřesňuje, neruší.
- **ADR 0004 (pevný 30Hz simulační krok, render interpoluje).** Komentáře `advanceFixed.ts:41–48` a `advanceFixed.ts:16–22` (previousSnapshot se nese mezi framy, jinak interpolace zamrzne). Důvod: deterministická simulace nezávislá na framerate. Nález 4 řeší duplicitu implementace, sémantiku kroku nemění.
- **ADR 0009 (simulace vlastní Rapier, `SimState` je POJO).** `FixedSimulation.ts:2–5`: „`RapierSimulation` in production, an in-memory fake in tests." Důvod: testovatelnost bez WASM. Nemazat fake-cestu při případném mazání `advanceFixed`.
- **ADR 0013 (reconcile seeduje `positionHistory` acknutým tickem).** `predictionLoop.ts:44–52` (`keepAckedInHistory`, vždy `true` v produkci). Důvod: oprava replay-chyby, harness drží regresní test. Nesahej na default bez nového důkazu.
- **ADR 0005 / 0012 / 0016 (Rapier sdílená simulace; mirror-entitiy; props se nepredikují).** `game/index.ts:44` (`PropPredictionController`, `graceTicksForRtt`), `predictionLoop.ts:24` (`PropPredictionController` jako typ). Důvod: autoritativní server, klient predikuje jen vlastní kapsli. Konsolidační refaktoring nesmí rozšířit predikci na props.
- **Track-builder Playtest kontrakt.** `App.tsx:6–10`: `?track=` vybírá trať z Playtest odkazu. Důvod: integrace s track-builderem. Přesuny složek nesmí změnit routy `/` a `/play` ani query parametr.

## 6. Doporučené pořadí (sekvence kroků)

1. **Rozhodnout o `advanceFixed` (Nález 4).** Nejmenší diff, největší odstranění šumu: varianta A (napojit `PredictionLoop` na `advanceFixed`) nebo B (smazat `advanceFixed.ts` + `FixedSimulation.ts` + testy). Bez tohoto rozhodnutí se krok 2 opírá o dvojí pravdu.
2. **Vyčistit exporty `shared` (Nález 2).** Přesun `tokens.css → packages/ui`, `playground.ts → client-only`. Opravit importéry, zkontrolovat `packages/shared/package.json:8–12`. Až po kroku 1, aby se exportní mapa měnila najednou.
3. **Fyzicky rozdělit `game/` na `sim/` vs. zbytek (Nález 1).** Přesun souborů, aktualizace `SHELL`/`GAME` v `codeSplitBoundary.test.ts:23–26`, zelený test jako akceptační kritérium. Žádné změny chování.
4. **Zamknout směr závislostí lintem (Nález 3).** `no-restricted-imports` / workspace dep-lint nad výslednou strukturou z kroku 3. Lint musí padnout na každém novém porušení; `codeSplitBoundary.test.ts` zůstává jako bundle-level pojistka.
5. **Konsolidovat reuse kandidáty (kap. 4, body 2–5).** Interpolace, reconcile-prahy, vstup → `SimInputs`, track-typy. Až po stabilní hranici — jinak se sjednocuje něco, co se ještě stěhuje.
6. **Regresní ověření.** `typecheck` + `vitest` v `apps/client`, `packages/shared`, `apps/server`; manuální Playtest přes `?track=` (kontrakt `App.tsx:6–10`); kontrola velikosti menu-bundlu (ADR 0008: nesmí narůst o three/Rapier).

---

*Podklady: čteno z `apps/client/src/App.tsx:1–30`, `apps/client/package.json:1–30`, `packages/shared/package.json:1–24`, `packages/shared/src/index.ts:1–43`, `packages/shared/src/timing/advanceFixed.ts:1–81`, `packages/shared/src/timing/FixedSimulation.ts:1–11`, `apps/client/src/net/predictionLoop.ts:1–52,163–165`, `apps/client/src/game/index.ts:1–58,329`, `apps/client/src/codeSplitBoundary.test.ts:1–143`, `apps/server/package.json:1–22`. Změny kódu mimo tento soubor nebyly provedeny.*

---

# Část 2 — hloubkový průchod po souborech

*Rozsah: server (`apps/server/src/`), sdílená simulace (`packages/shared/src/simulation/RapierSimulation.ts`). Pro oblasti klientí herní smyčka, shell+ui, builder+service a cross-cutting tento průchod nepřináší žádné nové ověřené nálezy nad rámec Části 1 (nálezy 1–4) — níže je u každé z nich výslovně uvedeno, že se potvrzuje stav z Části 1 bez nového dělení. Vše je ukotveno v kódu ve tvaru `soubor:řádky`; mimo tento soubor nebyly provedeny žádné změny kódu.*

## 2.1 Serverové vrstvy (`apps/server/src/`)

### `matchServer.ts` — boot + connection koordinátor (~180 řádků vlastní logiky)

**Odpovědnosti s rozsahy řádků:**

- Boot / konfigurace (`matchServer.ts:117–157`): `startServer` řeší `trackServiceUrl` (`matchServer.ts:123–124`), testovací knoby `countdownMs` / `roundEndMs` / `playersToStart` / `trackFetch*` (`matchServer.ts:128–137`), boot-time `fetchTrack` (`matchServer.ts:142`), konstrukci `MatchRuntime` (`matchServer.ts:143–155`) a bind `WebSocketServer` (`matchServer.ts:157`). Jediná odpovědnost: procesní bootstrap.
- Playtest `?track=` reload (`matchServer.ts:159–212`): parsování URL parametru (`matchServer.ts:166`), `fetchTrack` podle id (`matchServer.ts:176`), kontrola `alreadyLoaded` (`matchServer.ts:182`), `sockets.size` stráž (`matchServer.ts:193`) s odmítnutími `4002` při selhání načtení (`matchServer.ts:178`) a `4001` při obsazeném serveru (`matchServer.ts:198`), atomický swap `rt.fetched = …` + `resetToFreshLobby` (`matchServer.ts:208–209`). Jediná odpovědnost: admission politika pro reload trati (asynchronní fetch + atomický swap).
- Join admission + registrace (`matchServer.ts:230–247`): odmítnutí mid-round joinu `4002` (`matchServer.ts:230–231`), `randomUUID` id (`matchServer.ts:235`), `trackSpawn(joinCount)` (`matchServer.ts:238`), registrace `sockets` / `inputs` / `lobbyPlayers` / `sim.addCharacter` (`matchServer.ts:241–247`) a odeslání `welcome` (`matchServer.ts:249–263`). Dvě odlišitelné odpovědnosti: fázová brána (phase-gate) vs. spawn/registrace vs. transportní `welcome`.
- Dispatch zpráv (`matchServer.ts:270–293`): `JSON.parse` stráž (`matchServer.ts:273–278`), `ping`/`pong` hodinový echo přes `performance.now` (`matchServer.ts:279–283`), `input → rt.inputs.receive` (`matchServer.ts:284–287`), lobby větev `handleLobbyMessage` (`matchServer.ts:292`). Jediná odpovědnost: transportní rámování/dispatch, nikoli zápasová logika.
- Close / cleanup (`matchServer.ts:295–317`): `RUNNING`-podmíněný DNF zápis (`matchServer.ts:303–306`), mazy `sockets` / `inputs` / `lobbyPlayers` (`matchServer.ts:307–309`), větev `eliminateCharacter` vs. `removeCharacter` (`matchServer.ts:315–316`). Dvě odlišitelné odpovědnosti: zápasová DNF/eliminační politika vs. transportní úklid.

**Verdikt vrstvení:** transport vs. logika jsou smíchané v jednom uzávěru `wss.on("connection")` (`matchServer.ts:159–319`), který taví transport, admission, spawn, dispatch i cleanup. Samotný soubor už není plný god-object (boot + connection koordinátor ~180 řádků), ale právě tento uzávěr je jediný blok k dělení. Vstupní bod `index.ts:1–39` je správně tenký (pouze `isMain` stráž + `SIGINT`/`SIGTERM` shutdown + re-export `startServer`; `index.ts:12–39`) — žádné dělení netřeba, a potvrzuje, že hranice leží v `matchServer.ts`, ne v entry.

**Konkrétní split s názvy funkcí:**

1. Boot → nový `match/boot.ts`: `buildRuntimeConfig(config)` (resolve URL + knobů, dnes `matchServer.ts:123–137`) + `bootRuntime(config)` (fetch + `new MatchRuntime`, dnes `matchServer.ts:142–155`) vracející `{ rt }`; ve `startServer` zbude tenký wire-up.
2. Playtest reload → nový `match/playtestReload.ts`: `tryPlaytestReload(rt, socket, req): Promise<boolean-consumed>`; odmítnutí `refuseBusy` (dnes `matchServer.ts:193–200`) a `failedLoad` close (dnes `matchServer.ts:177–180`) uvnitř.
3. Join + disconnect → nový `match/connectionController.ts`: `canJoinDuringPhase(rt): boolean` (fázová brána, dnes `matchServer.ts:230–233`) + `registerPlayer(rt, id, spawn)` (registrace, dnes `matchServer.ts:241–247`) s builderem `buildWelcome(rt, id, spawn)` (dnes `matchServer.ts:249–263`); `handleDisconnect(rt, id)` (fázová/DNF/sim větev, dnes `matchServer.ts:303–316`) volaná z tenkého `socket.on("close")`.
4. Dispatch → nový `net/messageDispatcher.ts`: `dispatchClientMessage(rt, id, socket, raw)` (dnes `matchServer.ts:270–293`), s transportní větví `handlePing` (dnes `matchServer.ts:279–283`).

**Návrh kontroleru:** `match/connectionController.ts` je hranice, kde má vzniknout *Controller modul* — admission (`canJoinDuringPhase`), registrace (`registerPlayer` + `buildWelcome`) a odpojení (`handleDisconnect`) na jednom místě, takže `wss.on("connection")` zůstane jen tenkým transportním obalem (socket ↔ kontroler ↔ runtime).

### `match/matchRuntime.ts` — stav + operace (`matchRuntime.ts:73–189` + `matchRuntime.ts:227–509`)

**Odpovědnosti s rozsahy řádků:** jedna mutabilní třída nese registr připojení (`sockets`, `lobbyPlayers`, `inputs` — `matchRuntime.ts:74–85`), stav zápasových fází (`match`, `dnf`, `roundResults`, `matchStructure`, `nextRoundReady`, one-shot hrany `startRequested`/`returnToLobbyRequested` — `matchRuntime.ts:121–185`) a stavbu světa (`resolveRules` `matchRuntime.ts:227–240`, `setRoundType` `matchRuntime.ts:248–252`, `buildMatchStructure` `matchRuntime.ts:344–363`, `buildSimulationFor` `matchRuntime.ts:395–412`, `rebuildSimulation` `matchRuntime.ts:456–463`, `resetToFreshLobby` `matchRuntime.ts:482–491`, `startNextRound` `matchRuntime.ts:505–508`). Tři odlišitelné odpovědnosti: registr připojení vs. stav fází zápasu/kola vs. stavba světa.

**Verdikt vrstvení:** logika zápasu vs. stavba simulačního světa — čistá logika (fáze, pravidla, struktura zápasu) smíchaná s konstrukcí `RapierSimulation` + `resolveTrack` + usazováním postav.

**Konkrétní split s názvy funkcí:** registr ponechat v `MatchRuntime`; stavbu světa extrahovat do `match/simulationFactory.ts` jako `buildSimulationFor(track, players, serverTick, rules)` (dnes metoda `matchRuntime.ts:395–412` + `syncTick`/usazení `matchRuntime.ts:407–410`); `rebuildSimulation` (`matchRuntime.ts:456–463`) se pak stane tenkým volajícím factory.

**Návrh kontroleru:** žádná nová *Controller třída zde není potřeba — `MatchRuntime` už je držitelem stavu; hranicí má být modul factory (stavba světa), ne kontroler.

### `match/matchLoop.ts` — tick pipeline (`matchLoop.ts:31–299`)

**Odpovědnosti s rozsahy řádků:** krokování fází `advanceMatchPhase` (`matchLoop.ts:63–74`), odběr vstupů `takeFor` (`matchLoop.ts:83–84`), `sim.tick` (`matchLoop.ts:86`), utracení hran (`startRequested`/`returnToLobbyRequested` — `matchLoop.ts:100–101`), přechodové vedlejší efekty (`ROUND_END` qualify `matchLoop.ts:116–118`, `RESULTS` push `matchLoop.ts:129–145`, `COUNTDOWN` rebuild `matchLoop.ts:150–168`, `LOBBY` reset `matchLoop.ts:168–193`), hodiny kola `roundEnding`/`timeLeftMs` (`matchLoop.ts:211–233`), snapshot + lobby broadcast (`matchLoop.ts:235–290`). Tři odlišitelné odpovědnosti: krokování fází vs. vedlejší efekty přechodů vs. snapshot broadcast.

**Verdikt vrstvení:** logika zápasu vs. transport — rozhodnutí o fázích a jejich efekty jsou propletené se sestavováním a rozesíláním snapshotů po socketech.

**Konkrétní split s názvy funkcí:** přechody přesunout do `match/phaseController.ts` jako `applyPhaseTransition(rt, nextMatch, thisTick)` (dnes `matchLoop.ts:100–196`); broadcast do `net/snapshotBroadcaster.ts` jako `broadcastSnapshot(rt, state, timeLeftMs)` (dnes `matchLoop.ts:235–290`); v `startMatchLoop` zbude pipeline: advance → inputs → tick → transition → snapshot.

**Návrh kontroleru:** `match/phaseController.ts` je druhý *Controller kandidát* vedle `connectionController.ts` — veškeré vedlejší efekty přechodů (qualify, výsledky, rebuildy, reset DNF/Ready) na jednom místě, testovatelné bez socketů a časovače.

## 2.2 Sdílené simulační god-objects (`packages/shared/src/simulation/`)

### `RapierSimulation.ts` — grab držení (`RapierSimulation.ts:527–531`, `RapierSimulation.ts:599–706`)

**Odpovědnosti s rozsahy řádků:** dotaz `isGrabEngaged` (`RapierSimulation.ts:527–531`, prohledává `activeGrabs` oběma směry), údržbová polovina `updateGrabs` (`RapierSimulation.ts:599–649`: odpočet držení, struggle-detekt, release, `grabbingId`/`heldByGrabberId`, zmrazené facing), pohybová polovina `applyGrabTether` (`RapierSimulation.ts:680–706`: `wishFor` součet, `setGrabSpeedMultiplier`, `setGrabTetherWish`). Dvě odlišitelné odpovědnosti uvnitř jedné mechaniky: stav držení ( maintenance, čte se ze snapshotu) vs. pohybový tether (musí běžet před `beginTick`, viz `RapierSimulation.ts:651–679`).

**Verdikt vrstvení:** sim vs. sim — nejde o vrstvení transport/logika, ale o god-object metody uvnitř simulace; iniciace (`resolveGrabInitiation`, `RapierSimulation.ts:546–575`) a obě poloviny držení žijí na jedné třídě vedle Hit/Bump logiky.

**Konkrétní split s názvy funkcí:** přesunout `isGrabEngaged` + `updateGrabs` + `applyGrabTether` do nového `GrabHoldManager.ts` (dnes neexistuje — nejbližší sourozenec je `GrabController.ts`, který drží cooldown/release kontrakt jedné postavy, nikoli stav držení páru); `RapierSimulation` si ponechá pouze volání `grabHolds.preTick(...)` / `grabHolds.postTick(...)` v místech dnešních volání (`RapierSimulation.ts:986`, `RapierSimulation.ts:1059`).

**Návrh kontroleru:** `GrabHoldManager` je *Controller třída* pro stav párového držení (`activeGrabs` mapa se přestěhuje s ním) — `RapierSimulation` zůstane orchestrátorem ticku, manager vlastníkem jedné mechaniky; stejný vzor jako existující `GrabController`/`HitController`/`DashController` pro per-postavu stav.

## 2.3 Klientí herní smyčka — beze změny (potvrzení Části 1)

Žádný nový ověřený nález: platí Nález 1 (rozdělit `game/` na `sim/` vs. `render`, strážce `codeSplitBoundary.test.ts`) a Nález 4 (rozhodnout o `advanceFixed` vs. `PredictionLoop`, varianta A/B). Tato část nepřidává nové soubory ani funkce — jen konstatuje, že serverové splity výše jsou nezávislé a nesmí měnit klientský kontrakt snapshotů (`ServerMessage`: `state`, `phase`, `roundRules`, `countdownMsLeft`, `dnf`, `lobby`, `roundResults` — `matchLoop.ts:270–290`).

## 2.4 Shell + UI — beze změny (potvrzení Části 1)

Žádný nový ověřený nález: platí Nález 2 (přesun `tokens.css → packages/ui`, `playground.ts → client-only`) a ADR 0008 (dynamický import hry ze shellu). Serverové kontrolery výše se shellu nedotýkají.

## 2.5 Builder + service — beze změny (potvrzení Části 1)

Žádný nový ověřený nález: Playtest kontrakt `?track=` (klient předává, server konzumuje v `matchServer.ts:166`) se navrženým přesunem do `tryPlaytestReload` nemění — mění se vlastník kódu, ne wire kontrakt. Track-typová konsolidace zůstává bodem 5 v kap. 4 Části 1.

## 2.6 Cross-cutting — beze změny (potvrzení Části 1)

Žádný nový ověřený nález: platí Nález 3 (lint `no-restricted-imports` nad novými hranicemi: `shared` nesmí importovat `apps/*`; `match/*` nesmí importovat `ws`/`net` transport — po splitu to lint ověří strojově). Nové moduly (`match/boot.ts`, `match/playtestReload.ts`, `match/connectionController.ts`, `match/phaseController.ts`, `match/simulationFactory.ts`, `net/messageDispatcher.ts`, `net/snapshotBroadcaster.ts`, `GrabHoldManager.ts`) se po vytvoření přidají do téže lint mapy.

## 2.7 Aktualizované pořadí (Část 2 vůči krokům Části 1)

Kroky 1–6 z Části 1 (§6) zůstávají v platnosti; splity z Části 2 se do nich vkládají takto:

1. **Krok 1 (rozhodnout `advanceFixed`)** — beze změny, stále první; serverové splity na něm nezávisí.
2. **Krok 2 (exporty `shared`)** — beze změny; navíc ze serveru nic do `shared` nepřibude (factory i kontrolery zůstávají v `apps/server`, `GrabHoldManager` v `packages/shared/src/simulation/` vedle `GrabController`).
3. **Krok 2.5 (nový — serverové kontrolery, malý diff, velká čitelnost):** `net/messageDispatcher.ts` (`dispatchClientMessage`) → `match/connectionController.ts` (`canJoinDuringPhase`, `registerPlayer`/`buildWelcome`, `handleDisconnect`) → `match/playtestReload.ts` (`tryPlaytestReload`) → `match/boot.ts` (`buildRuntimeConfig`/`bootRuntime`). Pořadí je od nejtenčího k nejsilnějšímu; každý krok je ověřen existujícími `matchServer.test.ts` bez změny kontraktu. Zařadit hned po kroku 2, před fyzickým dělením klienta — serverové přesuny nesmí měnit snapshot kontrakt, na který klientské dělení spoléhá.
4. **Krok 3 (rozdělit `game/` na `sim/` vs. zbytek)** — beze změny, až po 2.5, aby se klient dělil proti stabilnímu snapshot kontraktu.
5. **Krok 3.5 (nový — tick pipeline):** `match/phaseController.ts` (`applyPhaseTransition`) + `net/snapshotBroadcaster.ts` (`broadcastSnapshot`) + `match/simulationFactory.ts` (`buildSimulationFor`). Až po 2.5 (staví na stabilním `MatchRuntime`), nezávisle na kroku 3 — lze paralelně s ním.
6. **Krok 4 (lint hranic)** — rozšířen: kromě hranic z Části 1 zamkne i nové serverové hranice (`match/*` bez `ws` importů kromě `connectionController`/`boot`; `net/*` bez zápasové logiky) a existenci `GrabHoldManager` vedle `GrabController`.
7. **Krok 5 (reuse kandidáti)** — rozšířen o grab: po extrakci `GrabHoldManager.ts` ověřit, zda `GrabController` (per-postava cooldown/release) a `GrabHoldManager` (párové držení) nesdílejí duplicitní struggle/release logiku; případně sjednotit práh `GRAB_STRUGGLE_*` na jediný zdroj pravdy.
8. **Krok 6 (regresní ověření)** — beze změny, navíc `apps/server` testy (`matchServer.test.ts`, `roundDraw.test.ts`) a `RapierSimulation.test.ts` / `GrabController.test.ts` po grab-split.

*Podklady Části 2: čteno z `apps/server/src/matchServer.ts:117–319`, `apps/server/src/index.ts:1–39`, `apps/server/src/match/matchRuntime.ts:73–216,227–252,344–363,395–412,456–463,482–491,505–508`, `apps/server/src/match/matchLoop.ts:31–299`, `packages/shared/src/simulation/RapierSimulation.ts:526–575,599–706,986,1059`. Změny kódu mimo tento soubor nebyly provedeny.*
