# Track Builder — implementační architektura pro DON'T FALL

> **Účel:** Postavit webový editor tratí pro multiplayerovou překážkovou hru DON'T FALL. Trať se skládá z předem schváleného katalogu modulů; uživatelé sdílejí pouze data o skladbě, nikdy vlastní mesh, skript nebo fyzikální kód.
>
> **Hlavní princip:** Jeden kanonický `TrackSnapshot` pro editor, validátor, serverový runtime, klientský renderer, test mode, publishing, replay i bug report. Typ dílu je popsán jedinou `PieceDefinition`, ze které všechny tyto vrstvy čtou.

---

## 1. Rozhodnutí v kostce

Track builder není obecný 3D editor ani open-world streaming engine. Je to editor pro 4–16 hráčů v instancovaném matchi, který skládá závodní/survival tratě z omezeného katalogu bezpečných dílů.

Priorita je:

1. Správný datový kontrakt a deterministický runtime.
2. Příjemný editor: snap, copy/paste, undo/redo, test mode.
3. Serverová validace a immutable publishing.
4. Teprve po profilování optimalizace: instancing, dormant mechanismy, AOI.
5. Později discovery/workshop.

To odpovídá tomu, jak fungují úspěšné blokové editory: Trackmania používá explicitní placement parametry a mřížky; Fall Guys Creative staví na omezené sadě předpřipravených objektů, rozpočtu a testu před publikací; Golf With Your Friends kombinuje level editor a distribuci komunitních tratí.[cite:246][cite:268][cite:285]

---

## 2. Architektura systému

```text
                         Piece Catalog
                    (verzované definice dílů)
                               |
                               v
Editor -----------------> Track Draft ------------------+
  placement / history          |                         |
                               v                         v
                         Client validation        Server validation
                               |                         |
                               +-----------+-------------+
                                           |
                                           v
                                  Immutable TrackSnapshot
                                           |
                   +-----------------------+-----------------------+
                   |                       |                       |
                   v                       v                       v
              Test Mode              Match Runtime          Publish / Share
          real shared simulation    server authoritative    revision + code
                   |                       |
                   +----------> telemetry / replay <---------+
```

Nejdůležitější vztah je:

```text
PieceDefinition
      |
      +--> Editor: placement, snap, property panel, gizma
      +--> Validator: bounds, sockets, overlap, budget, feasibility
      +--> RuntimeFactory: visual, Rapier collider, mechanism runtime
      +--> Asset loader: GLB, textura, audio, LOD/instancing metadata
      |
TrackSnapshot
      |
      +--> Test Mode
      +--> Server match
      +--> Client render
      +--> Published immutable revision
```

`PieceDefinition` popisuje, **co typ dílu umí**. `TrackPiece` popisuje, **kde je jeho jedna instance na konkrétní trati**. Nikdy nemíchat obě věci do jednoho JSON objektu.

---

## 3. Kanonický datový model

### 3.1 Zásady modelu

- Track JSON obsahuje pouze reference na známý katalog a parametry instancí.
- Trať nikdy neobsahuje binární mesh, URL libovolného assetu, JavaScript ani vlastní shader.
- Všechny identifikátory jsou stabilní; index pole není identita.
- Každá publikovaná verze je immutable snapshot.
- Rozděl verzi formátu, katalogu a gameplay pravidel — mění se nezávisle.

### 3.2 TypeScript kontrakt

```ts
export interface TrackSnapshot {
  schemaVersion: number;
  gameplayVersion: string;
  pieceCatalogVersion: string;

  trackId: string;
  revision: number;
  contentHash: string;

  bounds: TrackBounds;
  mode: "race" | "survival" | "final";
  seed: number;

  pieces: TrackPiece[];
  start: StartConfig;
  finish: FinishConfig;
  checkpoints: CheckpointConfig[];

  metadata: TrackMetadata;
}

export interface TrackBounds {
  min: Vec3;
  max: Vec3;
  buildGridSize: number;
  verticalGridSize: number;
}

export interface TrackPiece {
  /** UUID instance; nikdy neodvozovat z pozice či indexu. */
  id: string;
  /** Stabilní catalog ID, např. "core.floor.straight". */
  pieceType: string;
  /** Verze definice, kterou snapshot přesně očekává. */
  pieceVersion: number;

  transform: Transform;
  parameters: Record<string, JsonValue>;
  seed?: number;

  /** Volitelné explicitní napojení pro editor, validátor a graph. */
  connections?: PieceConnection[];
}

export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale?: Vec3;
}

export interface PieceConnection {
  localSocketId: string;
  targetPieceId: string;
  targetSocketId: string;
}

export interface StartConfig {
  position: Vec3;
  rotation: Quat;
  spawnSlots: number;
}

export interface FinishConfig {
  volume: BoxVolume;
  qualificationMode: "first_n" | "time_limit" | "first_player";
  qualificationCount?: number;
  timeLimitMs?: number;
}

export interface CheckpointConfig {
  id: string;
  order: number;
  volume: BoxVolume;
  respawn: Transform;
}

export interface TrackMetadata {
  name: string;
  description?: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}
```

`schemaVersion` znamená, jak číst JSON. `pieceCatalogVersion` říká, proti jakému katalogu byl level validovaný. `gameplayVersion` fixuje význam mechanik a tuning, protože změna rychlosti spinneru může změnit hratelnost starého levelu, i když jeho JSON zůstane beze změny.

---

## 4. PieceDefinition: střed systému

Každý povolený blok, prop nebo mechanismus existuje v katalogu jako definice. Runtime nesmí mít rozrůstající se řetězec `if (spinner)`, `if (hammer)`, `if (bridge)`. Místo toho dispatchuje podle `kind` a schopností.

```ts
export interface PieceDefinition {
  id: string;
  version: number;
  displayName: string;
  category: PieceCategory;

  placement: PlacementRules;
  footprint: Footprint;
  sockets: SocketDefinition[];
  overlapPolicy: OverlapPolicy;

  visual: VisualDefinition;
  collision: CollisionDefinition;
  gameplay: GameplayDefinition;
  mechanism?: MechanismDefinition;

  capabilities: PieceCapabilities;
  budget: PieceCost;
  validation: PieceValidationRules;
}

export type PieceCategory =
  | "platform"
  | "structure"
  | "obstacle"
  | "moving_surface"
  | "interaction"
  | "checkpoint"
  | "decoration";

export interface PieceCapabilities {
  walkable: boolean;
  moving: boolean;
  lethal: boolean;
  interactive: boolean;
  checkpoint: boolean;
  dynamicPhysics: boolean;
  canBlockPath: boolean;
  canBeInstanced: boolean;
}

export interface PieceCost {
  /** Rozpočet, který hráč v editoru vidí. */
  build: number;
  /** Interní limit pro serverovou fyziku. */
  physics: number;
  /** Interní limit pro draw calls, vertices/textury a GPU. */
  render: number;
}
```

### 4.1 Proč jsou capability metadata nutná

Jedna vlastnost, například `moving`, má být dostupná editoru, validátoru, runtime factory i profileru. Díky tomu lze například:

- v editoru zobrazit varování pro dynamický díl;
- v budgetu navýšit physics cost;
- v runtime vytvořit kinematic body místo static collideru;
- ve validátoru přepnout na dynamic validation;
- ve streamingu rozhodnout, zda díl může být dormantní.

Mesh ani název souboru nesmí určovat gameplay. Vizualita může být obří gumový bonbon, ale gameplay kolize je stále explicitně definovaný cuboid, capsule nebo compound collider.

---

## 5. Placement, grid a sockety

### 5.1 Placement není výběr jediného režimu

Nedělit díly na „grid OR socket OR free“. Jeden díl může mít současně více pravidel:

```ts
export interface PlacementRules {
  grid?: GridConstraint;
  surface?: SurfaceConstraint;
  sockets?: SocketConstraint;
  freeTransform?: FreeTransformConstraint;
  rotation?: RotationConstraint;
}

export interface GridConstraint {
  snapX: boolean;
  snapY: boolean;
  snapZ: boolean;
  step: Vec3;
}

export interface RotationConstraint {
  allowedYawDegrees: number[];
  allowPitch: boolean;
  allowRoll: boolean;
}
```

Například rampa může mít grid snap v X/Z, fixní výšku Y, povolené otočení po 90 stupních a socket na vstupu i výstupu. Dekorativní palma může být volně umístitelná na povrchu, ale musí zůstat v bounds.

### 5.2 Footprint

Footprint není vizuální bounding box. Je to stavební kontrakt, který definuje obsazené buňky, stavební rozsah a bezpečnou kolizní rezervu.

```ts
export interface Footprint {
  localBounds: BoxVolume;
  occupiedCells: GridCell[];
  clearance: number;
  supportSurfaces: SurfaceDefinition[];
}
```

Footprint musí být předem známý pro každý díl. Právě ten umožňuje levnou první vrstvu overlap validace bez spuštění Rapieru. Princip pevného footprintu a opakovatelného kitu je zásadní pro konzistentní modulární skládání.[cite:239]

### 5.3 Sockety

```ts
export interface SocketDefinition {
  id: string;
  type: SocketType;
  accepts: SocketType[];

  localPosition: Vec3;
  localRotation: Quat;

  /** Semantika: zda je to vstup/výstup/bidirectional. */
  direction: "in" | "out" | "bidirectional";
  tags?: string[];
}

export type SocketType =
  | "floor"
  | "ramp_low"
  | "ramp_high"
  | "rail"
  | "mechanism_input"
  | "mechanism_output";
```

Socket musí mít plný lokální frame (`position + rotation`), tedy implicitně forward/up směr. Pouhá pozice nestačí: nepoznáš, jestli se rampa připojuje správným koncem, ani zda je otočená o 180 stupňů. Trackmania a modulární systémy pracují s explicitními placement/pivot metadaty místo odvozování z mesh geometrie.[cite:257][cite:268]

### 5.4 Algoritmus snapu

```text
1. Vyber kandidátní transform z kurzoru/raycastu.
2. Získej kandidátní sockety v radiusu snapu.
3. Vyfiltruj kompatibilní type + accepts + direction.
4. Spočítej transform, který zarovná local frame socketu A proti socketu B.
5. Aplikuj grid/rotation constraint.
6. Proveď rychlou footprint + bounds validaci.
7. Pokud je validní, zobraz zelený ghost; jinak červený ghost a konkrétní důvod.
```

Volný mód má být výjimka, ne výchozí režim: uživatel musí moci dočasně vypnout snap a přesně posouvat/natáčet díl v jemném kroku. Trackmania obdobně nabízí free placement vedle mřížkového umístění.[cite:255][cite:266]

---

## 6. Vizuál, kolize a gameplay

```ts
export interface VisualDefinition {
  assetId: string;
  lodAssetIds?: string[];
  materialVariants?: string[];
  instancing: "none" | "static" | "gpu";
  castShadow: boolean;
}

export interface CollisionDefinition {
  bodyType: "none" | "fixed" | "kinematic" | "dynamic";
  collider: ColliderShapeDefinition;
  collisionLayer: "world" | "obstacle" | "trigger" | "decoration";
  friction?: number;
  restitution?: number;
}

export type ColliderShapeDefinition =
  | { kind: "box"; halfExtents: Vec3 }
  | { kind: "capsule"; radius: number; halfHeight: number }
  | { kind: "cylinder"; radius: number; halfHeight: number }
  | { kind: "compound"; children: ColliderChild[] };

export interface GameplayDefinition {
  surface?: "normal" | "ice" | "conveyor" | "bounce";
  lethal?: boolean;
  trigger?: TriggerDefinition;
  respawnRule?: "default" | "checkpoint" | "eliminate";
}
```

Tato separace je povinná. Renderer načítá GLB, Rapier dostává explicitní collider a gameplay systém dostává explicitní pravidla. Změna textury, LOD nebo modelu pak nemůže omylem změnit fyziku nebo možnost dokončit level.

---

## 7. Deterministické mechanismy

### 7.1 Zásada

Mechanismus není „special-case piece“. Je to deklarativní definice, z níž runtime může odvodit stav pro simulační tick `T`.

```ts
export interface MechanismDefinition {
  kind: "spinner" | "moving_platform" | "pendulum" | "door" | "conveyor";
  parameterSchema: ParameterSchema;
  stateModel: "tick_function" | "state_machine";
  activation: "always" | "triggered" | "proximity";
}
```

U mechanismu řízeného globálním časem nesmí stav záviset na tom, kdy ho konkrétní klient poprvé uviděl. Pro spinner například:

```ts
rotationAtTick = initialRotation + angularSpeed * tick * TICK_DT
```

Tím jsou stejné výsledky dostupné runtime, replayi, validátoru i při znovuaktivování dormantního segmentu. Váš stávající `Spinner` už jde tímto směrem — rotaci odvozuje z ticku a není nutné ji neustále plně replikovat.

### 7.2 Příklady parametrů

```ts
export interface SpinnerParams {
  angularSpeedRadPerSec: number;
  armLength: number;
  phaseRad: number;
  knockbackScale: number;
}

export interface MovingPlatformParams {
  path: Vec3[];
  periodTicks: number;
  phaseTicks: number;
  mode: "loop" | "ping_pong";
}

export interface DoorParams {
  initiallyOpen: boolean;
  openDurationTicks: number;
  triggerChannel?: string;
}
```

### 7.3 Dynamické mechanismy a server autorita

- Server je jediná autorita pro shared physics a trigger výsledky.
- Klient může vizuálně interpolovat/přednačíst předem odvoditelný mechanismus, ale nesmí rozhodovat kolize, kill nebo otevření dveří.
- Mechanismy s přímou sdílenou fyzikou a hráčskou interakcí jsou dražší a méně predikovatelné; pro MVP preferovat kinematic/pure-function překážky před volnými dynamic rigid bodies.
- Díl s `dynamicPhysics: true` je výjimka, má vysoký physics budget a explicitní validační pravidla.

---

## 8. RuntimeFactory a serverový spawn

```ts
export interface RuntimePiece {
  pieceId: string;
  visual?: RenderObject;
  rigidBody?: Rapier.RigidBody;
  colliders: Rapier.Collider[];
  mechanism?: MechanismRuntime;
  triggers: TriggerRuntime[];
}

export function spawnTrack(
  snapshot: TrackSnapshot,
  catalog: PieceCatalog,
  context: RuntimeContext,
): RuntimePiece[] {
  // 1. Ověřit schema/catalog/gameplay kompatibilitu.
  // 2. Pro každý TrackPiece najít přesnou PieceDefinition.
  // 3. Vytvořit explicitní Rapier body/collidery.
  // 4. Vytvořit mechanism runtime z kind + parameters + track seed.
  // 5. Zaregistrovat checkpointy, finish, trigger graph a spatial index.
}
```

Server musí snapshot vždy znovu validovat před spawnem. Klientská validace je pro okamžitou zpětnou vazbu, ale není bezpečnostní hranice: upravený browser request, poškozený JSON nebo neznámý `pieceType` nesmí vytvořit nekontrolovaný collider, neznámý asset ani kód na serveru.

---

## 9. Validace: ne boolean, ale sada diagnóz

### 9.1 Výstup validátoru

```ts
export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  pieceIds: string[];
  location?: Vec3;
  remediation?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  metrics: TrackMetrics;
}
```

Publikování blokují pouze `error`. Warning informuje o riziku, info slouží jako design lint a nápověda. Nevracet jen „level invalid“ — vracet konkrétní problém, relevantní instance a návrh opravy.

### 9.2 Čtyři vrstvy validace

| Vrstva | Otázka | Příklady |
|---|---|---|
| Strukturální | Je JSON a katalogová reference validní? | schema, unikátní ID, známý piece type, platné parametry |
| Placement | Je díl umístěn legálně? | bounds, grid, socket compatibility, overlap policy |
| Hratelnost | Může hráč projít? | start → checkpointy → finish, jump/dash/drop feasibility |
| Dynamika a runtime | Je chování mechanismů bezpečné a dosažitelné? | dveře, trigger graph, pohyblivé plošiny, timing gate |

### 9.3 Strukturální validace

Kontroly minimálně:

- přesně jeden start a alespoň jeden finish;
- platný `schemaVersion`, `gameplayVersion`, `pieceCatalogVersion`;
- unikátní `TrackPiece.id`;
- každý `pieceType` existuje v povoleném catalog snapshotu;
- parametry projdou `parameterSchema` daného dílu;
- transform obsahuje konečná čísla, normalizovaný quaternion a rozumné scale limity;
- checkpoint order je unikátní, monotónní a má platný respawn;
- track se vejde do povolených bounds;
- rozpočty nepřesahují profil zvoleného game modu.

### 9.4 Placement a overlap validace

Globální zákaz overlapu je chyba. Podlaha a její podpěra se mohou legitimně překrývat; spinner může mít pivot uvnitř platformy. Pravidlo musí určovat definice dílu:

```ts
export type OverlapPolicy =
  | { kind: "allow" }
  | { kind: "allow_same_group"; group: string }
  | { kind: "forbid"; withLayers: string[] }
  | { kind: "custom"; validatorId: string };
```

Validátor má dvě rychlostní úrovně:

1. **Footprint broad phase** — grid/bounds/AABB; probíhá během dragování v editoru.
2. **Collider narrow phase** — přesné překryvy schválených colliderů; probíhá před testem a publish.

### 9.5 Movement feasibility graph

A* je užitečný algoritmus pro prohledávání grafu, ale není samotný model hratelnosti. DON'T FALL není hra, kde agent jen chodí po navmeshi; pohyb je přechod mezi plochami:

```text
surface --walk--> surface
surface --jump--> landing surface
surface --dash--> landing surface
surface --drop--> lower surface
```

```ts
export interface FeasibilityNode {
  id: string;
  surface: SurfaceDefinition;
  representativePoints: Vec3[];
}

export interface FeasibilityEdge {
  from: string;
  to: string;
  action: "walk" | "jump" | "dash" | "drop";
  confidence: "safe" | "tight";
  estimatedTimeTicks: number;
}
```

Validátor generuje uzly z walkable ploch a testuje hrany pomocí `CanPlayerReach(A, B, movementType)`. Teprve nad vzniklým grafem proběhne search start → každý checkpoint ve správném pořadí → finish.

### 9.6 Shared MovementSolver: žádný druhý physics engine

Nesnažit se napsat samostatný „validator physics“. Časem by se odchýlil od hry. Správná hranice je:

```text
shared movement model / constants
          |
          +--> CharacterController / Rapier simulation
          +--> MovementSolver for validator
          +--> editor trajectory preview
```

`MovementSolver` používá stejné tuning konstanty jako hra (`TICK_DT`, gravity, jump parametry, dash rychlost/délku, capsule rozměry), ale neduplikuje celý svět. Jeho účel je deterministicky odpovědět, zda bezpečný reprezentativní trajektorie přechod zvládne; těžké a hraniční případy se potvrdí skutečnou simulací v test mode.

```ts
export interface MovementSolver {
  canWalk(from: SurfacePose, to: SurfacePose): Feasibility;
  canJump(from: SurfacePose, to: SurfacePose): Feasibility;
  canDash(from: SurfacePose, to: SurfacePose): Feasibility;
  canDrop(from: SurfacePose, to: SurfacePose): Feasibility;
}
```

Výsledek není jen true/false. Musí umět říct např. „dosažitelné, ale přistávací plocha má margin 4 cm“ — to je warning `tight_jump`, ne nutně error.

### 9.7 Dynamic validation

Static reachability nestačí pro pohyblivé plošiny, dveře, triggery a časové brány. Dynamic validation má minimálně tyto kontroly:

- každá `triggerChannel` reference vede na existující mechanismus;
- trigger graph neobsahuje nechtěný cyklus;
- kritická cesta existuje alespoň pro jednu validní časovou fázi mechanismů;
- dveře/bridge nejsou jedinou cestou bez dostupného triggeru;
- moving platform se dostane do pozice, ze které je možný nástup i výstup;
- periodické mechanismy mají omezené parametry (rychlost, amplituda, duty cycle);
- mechanismus nevytlačí hráče do nevyhnutelné smrti bez jasně čitelné telegraphy;
- aktivní collider mechanismu neprotíná permanentně spawn/finish/checkpoint volume.

Pro složité tratě je možné spustit několik simulovaných test agentů přes skutečný runtime s různými timingy. To není náhrada formální reachability graph validace; je to doplňkový fuzz/regression test.

---

## 10. Test Mode je reálný režim

Test mode nesmí být fake editor preview.

```text
EDIT MODE
  - mutovat draft
  - grid/socket ghost
  - historie příkazů
        |
        | Freeze a canonicalize draft
        v
TEST MODE
  - vytvořit TrackSnapshot
  - spustit stejnou RuntimeFactory jako match
  - spawn skutečného CharacterControlleru
  - používat skutečný Rapier svět a gameplay tuning
  - sbírat telemetry
        |
        +--> návrat do EDIT MODE, draft zůstává editovatelný
        |
        +--> publish jen z validovaného snapshotu
```

Před přepnutím do testu editor automaticky spustí quick validation. V testu se zaznamenává:

- nejvyšší dosažený checkpoint;
- čas průchodu a počet respawnů;
- aktivované triggery;
- collision / out-of-bounds diagnózy;
- budget metrics;
- případný failure reprodukovatelný přes `trackId + revision + seed + gameplayVersion`.

Fall Guys Creative obdobně vyžaduje splnění podmínek a testovací průchod před publikací; pro DON’T FALL má být test mode silnější, protože používá stejnou simulaci jako live match.[cite:243][cite:248]

---

## 11. Editor UX

### 11.1 Základní workflow

```text
1. Vytvoř draft z template (race/survival/final).
2. Vyber díl z katalogu.
3. Umísti jej přes grid/socket/surface snap.
4. Okamžitě zobraz placement validation.
5. Uprav parametry v inspectoru.
6. Použij duplicate, multi-select, copy/paste a undo/redo.
7. Spusť Test Mode.
8. Oprav issue podle severity.
9. Validuj na serveru a publikuj immutable revision.
```

### 11.2 Povinné nástroje MVP

- Výběr, přesun, otočení a smazání.
- Grid snap, socket snap a dočasný free mode.
- Jemný nudge posun/rotace.
- Multi-select a group transform.
- Duplicate.
- Copy/paste kompatibilních skupin mezi drafty.
- Undo/redo.
- Hierarchy/outliner s hledáním podle ID/kategorie.
- Inspector pro parameters a validační stav vybraného dílu.
- Toggle vrstev: collision, sockets, bounds, reachability graph, budget heatmap.
- Test Mode.

Multi-select a průběžný test existují i ve Fall Guys Creative; jejich absence rychle dělá úpravy větších sekcí trati frustrující.[cite:248]

### 11.3 Command architecture

Undo/redo nedělat ad hoc přes náhodné kopie stavu. Použít příkazový model:

```ts
export interface EditorCommand {
  id: string;
  execute(state: TrackDraft): void;
  undo(state: TrackDraft): void;
  mergeWith?(next: EditorCommand): EditorCommand | null;
}

export class PlacePieceCommand implements EditorCommand {}
export class DeletePiecesCommand implements EditorCommand {}
export class MovePiecesCommand implements EditorCommand {}
export class RotatePiecesCommand implements EditorCommand {}
export class DuplicatePiecesCommand implements EditorCommand {}
export class SetParametersCommand implements EditorCommand {}
```

Výhody: undo/redo, autosave, audit log, diff mezi revisions a případná budoucí collaboration mohou sdílet stejný model historie.

### 11.4 Čitelnost v editoru

Editor nesmí uživatele učit fyziku skrýváním důležitých věcí. Má zobrazit:

- zelený/červený ghost při placementu;
- socket směry a kompatibilní cíle;
- footprint a collider overlay;
- varování, když je pohyblivý díl drahý;
- jasné mapování validace na piece instance;
- samostatné zobrazení vizuálu a collision vrstvy;
- "why disabled" text, ne jen zakázané tlačítko.

Rozpočet má být živý ukazatel. Fall Guys zobrazuje cost objektu a limit při stavbě; stejný princip je vhodný, ale DON’T FALL interně sleduje odděleně build, physics a render cost.[cite:248]

---

## 12. Budget model

Jeden univerzální cost je dobrý pro jednoduché UX, ale slabý pro runtime ochranu. Použít tři interní osy:

```ts
export interface TrackBudget {
  build: { used: number; limit: number };
  physics: { used: number; limit: number };
  render: { used: number; limit: number };
}
```

Příklad:

| Díl | Build | Physics | Render | Poznámka |
|---|---:|---:|---:|---|
| Statická podlaha | 1 | 1 | 1 | Může být instancovaná |
| Rampa | 2 | 1 | 2 | Statický collider |
| Spinner | 10 | 20 | 5 | Kinematic mechanismus |
| Moving platform | 12 | 25 | 6 | Vyžaduje dynamic validation |
| Dekorace | 1 | 0 | 3 | Bez collideru nebo s trigger-free colliderem |
| Volný physics prop | 8 | 45 | 4 | Výjimka, limitovat počet |

Uživateli lze primárně ukazovat jeden jednoduchý "Build Budget" a při detailu/varování odhalit physics a render limity. Server publish gate ale musí vynutit všechny tři.

---

## 13. Výkon: optimalizovat až podle měření

### 13.1 Co není potřeba v MVP

Pro instancovaný match s 4–16 hráči, přibližně 100–300 díly a desítkami aktivních mechanismů není nutné nejdřív budovat open-world streaming. Nejprve změřit:

- počet Rapier rigid bodies a colliderů;
- time per physics tick;
- snapshot velikost a outbound bytes/player/sec;
- draw calls, triangles, GPU frame time;
- počet unikátních materiálů/textur;
- GC pressure a asset decode time;
- nejhorší editor operation a přechod do Test Mode.

### 13.2 Optimalizace v pořadí

1. **Levný content:** limity a více-osý budget.
2. **Render:** static batching, GPU instancing pro opakované core pieces, shared materials, LOD, frustum culling.
3. **Physics:** slučovat statické collidery kde je bezpečné, nedávat collider dekoracím, preferovat kinematic pure-function mechanismy před stovkami dynamic bodies.
4. **Replication:** neposílat stav statických dílů; state periodických mechanismů odvodit z ticku + parametrů; posílat jen změny/události a nezbytné dynamic stavy.
5. **Dormancy:** vzdálené/nepoužívané mechanismy mohou být bez aktivní fyziky, ale jejich stav musí jít dopočítat z ticku nebo obnovit z autoritativního snapshotu.
6. **AOI / interest management:** až když profiler ukáže, že replikace větší tratě je dominantní problém.

### 13.3 Loaded / Active / Dormant

Pro pozdější optimalizaci nepřebírat bez změny open-world model. Použít jednodušší lifecycle:

| Stav | V paměti | Render | Fyzika | Síťový state |
|---|---|---|---|---|
| Loaded | Ano | Volitelně | Ne | Definice/seed známé |
| Active | Ano | Ano | Ano | Replikace dle relevance |
| Dormant | Ano nebo cache | LOD/hidden | Ne | Stav odvoditelný nebo uložený |
| Unloaded | Ne | Ne | Ne | Jen katalogová reference |

Přechod se nesmí řídit jen vzdáleností. Vstupy jsou `distance`, `progress`, `line-of-sight` a především **dependency**: vzdálené dveře mohou být relevantní, pokud je má otevřít trigger vedle hráče.

### 13.4 Interest management

Interest management je serverové filtrování: hráč obdrží jen stav objektů, které jsou pro něj relevantní. Photon Fusion například rozlišuje Area of Interest, object interest a per-property interest groups.[cite:263] Tento princip má v budoucnu smysl zejména pro vzdálené hráče, dynamic props a neodvoditelné mechanismy, ale není to MVP požadavek.

Doporučený model pro DON’T FALL:

```text
always relevant:
  - vlastní Character snapshot
  - match pravidla, čas, kvalifikace
  - mechanismy ovlivňující aktuální cestu nebo dependency graph

nearby relevant:
  - hráči a dynamic props v aktivních segmentech
  - kolizní mechanismy v předvídaném směru pohybu

not replicated / low frequency:
  - vzdálená kosmetika
  - statické moduly (jsou v TrackSnapshot)
  - periodické mechanismy, jejichž stav lze odvodit z ticku
```

Základní prostorový index může být uniformní grid/hash nad segmenty a objekty. Interest management obecně redukuje síťový provoz tím, že replikuje relevantní subset světa místo všeho všem.[cite:258][cite:263]

---

## 14. Web-native asset pipeline

Unity Addressables není architektura pro webový Three.js projekt. Ekvivalentem je **manifest + content-addressed GLB/GLTF assety + HTTP cache/Service Worker + runtime asset cache**.

```text
Blender / source asset
      |
      v
GLB (glTF 2.0)
      |
      +--> mesh optimization / Meshopt nebo Draco
      +--> KTX2 textury, rozumné WebP/AVIF zdroje
      +--> LOD varianty podle potřeby
      |
      v
hashed CDN URL + asset manifest
      |
      v
browser cache / Service Worker
      |
      v
GLTFLoader + process-local asset cache
```

Každá `PieceDefinition.visual.assetId` vede přes manifest na hashovaný soubor:

```json
{
  "id": "obstacle.spinner.basic",
  "version": 3,
  "visual": {
    "url": "/assets/obstacle.spinner.basic.a91cde2.glb",
    "integrity": "sha256-..."
  },
  "collision": {
    "kind": "compound",
    "version": 2
  }
}
```

glTF/GLB je pro Three.js přirozený runtime formát a `GLTFLoader` podporuje běžné kompresní/transportní rozšíření včetně Draco, Meshopt a KTX2 workflow.[cite:281] Hashovaný filename umožňuje neměnný cache headers (`Cache-Control: immutable`), bezpečný CDN rollout a jednoduché zrušení cache při změně assetu.

### 14.1 Asset vs. UGC data

| Věc | Kde žije | Může ji vytvářet hráč? |
|---|---|---|
| GLB, textura, audio, collider definice | Schválený piece catalog/CDN | Ne v první verzi |
| `PieceDefinition` | Verzovaný katalog | Ne v první verzi |
| `TrackSnapshot` (instance, transform, parametry) | UGC databáze | Ano |
| Screenshot/thumbnail | Backend pipeline | Ano, ale sanitizovaně |

UGC trať tedy vypadá například takto:

```json
{
  "pieceType": "obstacle.spinner.basic",
  "pieceVersion": 3,
  "transform": {
    "position": { "x": 10, "y": 4, "z": 20 },
    "rotation": { "x": 0, "y": 0, "z": 0, "w": 1 }
  },
  "parameters": {
    "angularSpeedRadPerSec": 1.5,
    "phaseRad": 0
  }
}
```

Neobsahuje mesh blob ani libovolné URL. To zjednodušuje bezpečnost, storage, caching, moderaci i možnost garantovat stejnou kolizi všem hráčům.

---

## 15. Publishing, revize a kompatibilita

### 15.1 Lifecycle

```text
Draft (mutable, autor může editovat)
      |
      v
Client validation
      |
      v
Server validation + canonicalization
      |
      v
Playtest pass
      |
      v
Published TrackSnapshot (immutable)
      |
      +--> revision 1
      +--> revision 2
      +--> revision 3
```

Žádný live match nesmí odkazovat na mutable `levelId -> JSON`. Odkazuje na přesnou trojici `trackId + revision + contentHash` a zároveň uloží `schemaVersion`, `pieceCatalogVersion`, `gameplayVersion`.

```ts
export interface PublishedTrackRef {
  trackId: string;
  revision: number;
  contentHash: string;
  schemaVersion: number;
  pieceCatalogVersion: string;
  gameplayVersion: string;
}
```

Díky tomu lze později přesně reprodukovat replay, bug report i sporný match. Autor opraví chybu vytvořením nové revision, ne tichou mutací staré tratě.

### 15.2 Server canonicalization

Při publish server:

1. Znovu načte a parsuje request.
2. Odmítne neznámé fieldy, neznámý díl nebo neplatné parametry.
3. Normalizuje quaternion, float precision, pořadí polí/pieces a grid rounding.
4. Spočítá `contentHash` z kanonické reprezentace.
5. Spustí všechny validační vrstvy.
6. Uloží immutable snapshot a vrátí share code.

### 15.3 Share code a discovery

První verze má mít jednoduchý share code jako Fall Guys Creative: autor publikuje revision a získá kód, který mohou přátelé vložit do custom lobby.[cite:246] Discovery, likes, featured lists, reporting a workshop browser přicházejí až po stabilizaci validity/publishing pipeline.

---

## 16. Doporučené TypeScript balíčky

```text
packages/shared/
  track/
    TrackSnapshot.ts
    PieceDefinition.ts
    PieceCatalog.ts
    TrackSchema.ts
    TrackCanonicalize.ts
    TrackHash.ts
    MechanismDefinition.ts
    budget.ts

  track-validation/
    validateStructural.ts
    validatePlacement.ts
    validateBudget.ts
    buildFeasibilityGraph.ts
    MovementSolver.ts
    validateDynamic.ts
    ValidationIssue.ts

  track-runtime/
    RuntimeFactory.ts
    spawnTrack.ts
    MechanismRuntime.ts
    TrackSpatialIndex.ts
    TrackLifecycle.ts

apps/client/src/editor/
  EditorState.ts
  EditorCommand.ts
  placement/
  snapping/
  selection/
  inspector/
  validationOverlay/
  testMode/

apps/client/src/assets/
  PieceManifest.ts
  AssetCache.ts
  GLBLoader.ts
  service-worker.ts

apps/server/src/tracks/
  publishTrack.ts
  validateTrack.ts
  trackRepository.ts
  startMatchFromRevision.ts
```

`packages/shared` drží kontrakty a čistou logiku. `apps/server` drží autoritu publish/matchu. `apps/client` drží editor, render a UX, ale nikdy není jediná autorita validity.

---

## 17. Testovací strategie

### Unit testy

- Schema parse a backward-compatible migrace.
- Canonicalization a stabilní `contentHash`.
- Socket compatibility a transform alignment.
- Footprint placement a overlap policies.
- Budget součty a limity.
- Parameter schema pro každý mechanismus.
- MovementSolver pro walk/jump/dash/drop hraniční případy.
- Deterministický mechanism state pro stejný tick/seed.

### Integration testy

- `TrackSnapshot -> RuntimeFactory -> Rapier world` bez chyb.
- Server odmítne manipulovaný JSON, neznámý `pieceType` a neplatný parameter.
- Start, checkpointy a finish fungují v reálné simulaci.
- Periodický mechanismus má stejnou transform na serveru i klientovi pro tick T.
- Publish následovaný loadem revision znovu vytvoří stejný snapshot/hash.

### Regression a fuzz testy

- Generovat náhodné, ale schema-valid placementy a ověřovat, že validátor nikdy necrashne.
- Náhodně mutovat JSON z platných tratí a ověřovat server reject.
- Zaznamenávat nejhorší physics tick a snapshot payload pro budget profily.
- Pro kritické díly mít ručně kurátorované tratě: minimum, maximum, edge cases, dynamic timing, multi-player congestion.

---

## 18. Roadmap implementace

### Phase 1 — Core data model

- `TrackSnapshot`, `TrackPiece`, `PieceDefinition`, `PieceCatalog`.
- `Transform`, `Footprint`, `SocketDefinition`, `PieceCost`.
- Schema/versioning model (`schemaVersion`, `pieceCatalogVersion`, `gameplayVersion`).
- Canonicalization a content hash.
- První katalog: podlaha, rampa, wall, checkpoint, finish, spinner.

**Exit criterion:** Stejný JSON se spolehlivě parseuje, kanonikalizuje a hashne na klientu/serveru stejně.

### Phase 2 — Editor foundation

- Grid/socket/surface placement.
- Ghost preview a local placement validation.
- Selection, multi-select, duplicate, copy/paste.
- Command-based undo/redo.
- Inspector parametrů a outliner.

**Exit criterion:** Designer složí krátkou statickou trať bez ruční editace JSON.

### Phase 3 — Asset a runtime pipeline

- Piece manifest, GLB loader, cache, fallback asset.
- RuntimeFactory pro visual + Rapier collider + gameplay trigger.
- Static/kinematic/dynamic body policy.

**Exit criterion:** Stejný `TrackSnapshot` zobrazí klient a server spawne jeho kolize bez duplikace layout kódu.

### Phase 4 — Validace

- Structural, bounds, sockets, overlap policies, budget.
- Shared `MovementSolver` a feasibility graph.
- Checkpoint order/reachability.
- První dynamic validation pro spinner a moving platform.
- Severity systém a editor overlay.

**Exit criterion:** Invalidní trať vrátí konkrétní chyby s `pieceIds`; validní race má ověřenou cestu start → checkpointy → finish.

### Phase 5 — Real Test Mode

- Freeze draft do snapshotu.
- Stejný Rapier/gameplay runtime jako v matchi.
- Telemetry a návrat do editoru.
- Povinný úspěšný průchod pro publish race tratě.

**Exit criterion:** Trať nelze publikovat bez server validation a lokálního reálného dokončení.

### Phase 6 — Publishing

- Draft storage, immutable revision, publish endpoint.
- Server validation/canonicalization/hash.
- Share code a custom lobby load přes exact revision.
- Základ report/disable workflow.

**Exit criterion:** Dva hráči mohou přes share code hrát stejnou immutable revision.

### Phase 7 — Profiling a optimalizace

- Asset instancing, LOD, frustum culling.
- Statický collider merging podle měření.
- Dormant/active lifecycle pro mechanismy.
- Relevance filtering/AOI pouze pokud bandwidth nebo server tick profil ukáže potřebu.

**Exit criterion:** Definované performance budgets jsou zelené na cílovém min-spec zařízení a cílovém počtu hráčů.

### Phase 8 — Discovery a pokročilý UGC

- Search, tags, likes, featured, trending.
- Moderation queue, reporty, rate limits.
- Analytics pro design linting z reálných completion dat.
- Případná collaboration/edit permissions.

---

## 19. Anti-patterns: čemu se vyhnout

- **Nedělat level jako scénu uloženou z Three.js.** Ukládat data, ne object graph/render objects.
- **Nedovolit UGC assety v první verzi.** Jen instance katalogových dílů.
- **Neodvozovat kolizi z render meshe.** Collider je explicitní metadata.
- **Nespoléhat na klientský validator.** Server je autorita pro publish a match spawn.
- **Nevytvářet druhý, odlišný physics simulator pro validaci.** Sdílet movement model a používat reálný Test Mode.
- **Nezakazovat všechny overlaps.** Respektovat per-piece overlap policy.
- **Nespatřovat každý mechanismus jako speciální case.** Vynucovat capability + declarative mechanism contracts.
- **Nedělat streaming dřív než profiler.** Nejdřív budget, instancing, physics discipline a replikace jen změn.
- **Nemutovat publikované leveIy.** Publikace je immutable revision.
- **Nenechat UX na konec.** Undo/redo, duplicate, copy/paste a Test Mode jsou pro praktickou použitelnost důležitější než rané AOI.

---

## 20. Závěrečný architektonický invariant

Pokud má každý nový díl projít tímto kontraktem, systém zůstane rozšiřitelný:

```text
PieceDefinition
  identity + placement + footprint + sockets
  visual + collision + gameplay + mechanism
  capabilities + budget + validation rules
        |
        v
TrackPiece (instance)
        |
        v
TrackSnapshot (immutable published revision)
        |
        +--> Editor
        +--> Validator
        +--> RuntimeFactory
        +--> Test Mode
        +--> Multiplayer match
        +--> Replay / bug reproduction
```

To je skutečný střed track builderu. Grid, sockety, asset pipeline, validace, performance i publishing jsou až důsledky tohoto kontraktu, ne nezávislé subsystémy.