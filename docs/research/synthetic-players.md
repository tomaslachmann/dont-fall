# Syntetičtí protihráči jako vývojářský nástroj

*Research, 2026-09-20. Otázka: jak postavit 1–3 syntetické protihráče, se kterými si vývojář otestuje hru (trať, strkání, Hit/Grab, Survival), bez shánění lidských protihráčů.*

**Vymezení proti `testing-bots.md`:** ten soubor řeší boty na *automatizované* testování (load harness, scripted playtest, E2E, fuzz) — věci, které běží bez člověka a hlásí čísla. Tohle je jiné téma: *interaktivní soupeř pro ruční testování feelu*. Vývojář hraje v prohlížeči a 1–3 boti hrají proti němu. Není to shipovaný herní režim, není to matchmaking ani doplňování lobby — je to dev nástroj, který v produkci neběží. Proto tu není žádná produktová část (obtížnosti pro hráče, "hraj proti botům" režim); místo ní je §8 o dev-only zapojení.

## TL;DR

Doporučená architektura pro náš stack:

| # | Rozhodnutí | Jednou větou |
|---|---|---|
| 1 | Bot žije **na serveru** jako producent `SimInputs` | Žádní headless klienti přes socket; bot píše přímo do `tickInputs` vedle `InputRouter.takeFor` v `matchLoop.ts`. Nulová změna protokolu, bot nepotřebuje predikci ani rendering. |
| 2 | Řízení **výhradně přes input interface** (`SimInputs`) | Stejný tvar, jaký posílá hráč. Nikdy přímý zásah do stavu — jinak se rozbije `(state, inputs) -> state`, determinismus i cooldowny. |
| 3 | Rozhodování **5–10 Hz**, skládání inputu **30 Hz** | Steering/priority tickají řídčeji; každý sim tick se jen poskládá `SimInputs` (držení tlačítek, `facing`). Reakční zpoždění zdarma. |
| 4 | Navigace: **Checkpointy jako waypointy** + seek/arrive steering | Cíle se čtou z resolved Tracku (`checkpoints`/`finishZones`), pohyb je Reynolds seek/arrive. Timing překážek jde číst z deterministické Motion (čistá funkce Ticku). |
| 5 | Souboj přes **stejné konstanty jako hráč** | `HIT_RANGE`/`GRAB_RANGE`, kužel `COS_MIN`, charge/cooldown časování z `tuning/fight.ts`. Bot míří a mačká, sim rozhodne. |
| 6 | Dev-only za **env flagem** (`DONTFALL_BOTS=N`, precedent `DONTFALL_PERF=1`) | Boti se nikdy nepočítají do `connectedPlayers`, `everyoneLoaded` ani Lobby rosteru. Seed přes `DONTFALL_BOT_SEED` pro reprodukovatelnost. |
| 7 | **Žádný rubber-banding** | Dev nástroj má ukazovat skutečný feel; guma, která dorovnává ztrátu, by testování feelu zkreslovala. |
| 8 | Rozhodování = **prioritní seznam**, kód v `apps/server/src/debug/bots/` | §4.1 povýšený na kostru (první sedící pravidlo = důvod v logu), sekvence (charge, carry→Spin→Hurl) jako miniaturní FSM v listech (§10). Testy drží kontrakt čistých funkcí, chytrost ověřuje playtest. |

**První krok (tracer bullet):** idle bot — Character bez socketu, který stojí na spawnu, replikuje se na klienty jako normální Character a jde odpálit Hit/Grabem. Pak waypoint runner: běží po Checkpointech do cíle, padá, respawnuje, vstane. Až pak skoky, timing, souboj, Survival (§9).

---

## 1. Kde bot žije: server-side producent inputů

Tři kandidáti:

**A) Server-side generování inputů (doporučeno).** Bot je funkce `(pohledNaSvět, tick) -> SimInputs`, kterou match loop volá každý tick a výsledek přimíchá do `tickInputs` vedle vstupů ze socketů:

```ts
// apps/server/src/match/matchLoop.ts, dnes řádek ~217:
for (const id of rt.sockets.keys()) tickInputs[id] = rt.inputs.takeFor(id, thisTick);
// boti: navíc
for (const bot of rt.bots.values()) tickInputs[bot.id] = bot.inputFor(thisTick);
```

**B) Headless klienti přes socket.** To je architektura load-test botů z `testing-bots.md` bodu 1 (`FaithfulClient` + `PredictionLoop` + `ws`). Pro syntetické protihráče je to zbytečně těžké: bot by musel řešit time sync, tick seeding, LEAD, predikci a reconciliaci — všechno věci, které existují jen proto, že hráč sedí na druhé straně sítě s vlastním renderingem. Bot sedí vedle simu a nic z toho nepotřebuje.

**C) Hybrid (bot mimo server, inputy přes socket, ale bez predikce).** Kombinuje nevýhody obou: síťová režie a tick-addressing bez benefitu věrnosti.

Proč A sedí na naši architekturu:

- **Server je autorita a sim je čistý.** `RapierSimulation.tick(inputs, phase)` bere `Record<string, SimInputs>` a Character bez záznamu prostě stojí (`packages/shared/src/simulation/RapierSimulation.ts:1066`). Odkud input přišel — ze socketu nebo z botí funkce — sim vůbec nevidí. Bot je jen další klíč v mapě.
- **Nulová změna protokolu.** `packages/shared/src/net/protocol.ts` se nemění; klienti dostanou boty jako obyčejné Characters ve `SimState.characters` a vykreslí je beze změny kódu. Fairness replikací zdarma (§6).
- **Cena je zanedbatelná.** 1–3 boti × pár vektorových operací na steering tick; sim step pro 12 Characters už dnes měří `bench:sim`, botí logika je proti Rapier sweeps šum (§7).
- **Reprodukovatelnost.** Bot čte serverový stav a seedovaný tah (`slipRoll(id, tick)` idiom z `packages/shared/src/simulation/slipRoll.ts`) — stejný seed + stejné inputy hráče = stejný průběh, což je pro ladění bugu k nezaplacení. Přes socket by do toho vstupoval jitter.

**Jedna strukturální podmínka:** dnes match loop iteruje `rt.sockets.keys()` a `connectedPlayers: rt.sockets.size` (`matchLoop.ts:194,217`). Botí Character *nemá socket*, takže je potřeba oddělit "připojené sockety" od "Characters v simu": bot se přidá přes existující `simulation.addCharacter(id, trackSpawn(...))` (precedent `matchRuntime.ts:819`), ale nesmí se počítat do `connectedPlayers` (jinak by 1 hráč + 2 boti spustili start bez druhého člověka), do `everyoneLoaded` (bot nemá co loadovat — LOADING fáze z ADR 0089 čeká jen na klienty) ani do `standingsConfirmed`. To je malá, ale povinná změna; bez ní boti rozbijí Match flow.

## 2. Input-level řízení, nikdy zásah do stavu

`SimInputs` (`packages/shared/src/simulation/SimInputs.ts`) je prostý snapshot: `moveDirection` (normalizovaný XZ vektor, camera-relative už vyřešeno klientem), čtyři *held* booleany (`jumpHeld`, `dashHeld`, `hitHeld`, `grabHeld`) a `facing` (yaw v radiánech). Tlačítka jsou držení, ne hrany — sim si pressy odvozuje sám, což je přesně to, co dělá vstup replayovatelný (ADR 0003).

Bot je tedy producent `SimInputs`, nic víc:

- **Pohyb:** `moveDirection` = steering směr (§4 navigace), `facing` = yaw, kam je bot otočený. Bot si facing počítá sám integrací (stejný kontrakt jako klient z ADR 0045/0085: tělo se otáčí za během a drží při stání); sim ho jen zrcadlí a Hit/Grab podél něj míří (`CharacterController.ts:175`).
- **Skok/Dash:** podržet boolean na N ticků. Načasování skoku ("až bude zem pod nohama") bot čte z vlastního `grounded`, stejně jako `walkTrack.ts` čeká s `pendingJump` na zem (`walkTrack.ts:106`).
- **Hit:** držet `hitHeld` po dobu charge (plný charge `HIT_CHARGE_MAX_MS = 600`, `packages/shared/src/tuning/fight.ts:55`), pustit = rána. `HitController.beginTick` řeší zbytek včetně cooldownu 800 ms (`HitController.ts:61`).
- **Grab/Struggle:** `grabHeld` hrana = chycení/puštění; Struggle je střídání `moveDirection` (wiggle = reversal proti poslednímu směru v kosinu `-0.5`, `GRAB_WIGGLE_REVERSAL_DOT_MAX`), 12 wigglů proti drainu 0.2/s (`tuning/fight.ts:108`).
- **Spin/Hurl:** držet Hit za držení = Spin; pustit = Hurl mířený tangentou ±45° snap (`HURL_AIM_SNAP_DEG`).

Proč nikdy přímý zásah do stavu (teleport, set velocity, nucený stav):

1. Porušilo by to invariant ADR 0003/0005: sim je čistá funkce `(state, inputs) -> state`. Všechno, co není v `inputs`, není v replayi ani v seedu.
2. Obešlo by to fyzikální limity a cooldowny — bot by pak netestoval to, co hráč zažívá, ale nějakou jinou hru.
3. Stavový automat (`CharacterStateMachine.ts`) má jasný kontrakt: přechody se dějí v `tick()`, `Held` nastavuje jen `GrabHolds` zvenčí. Bot, který by do automatu sahal, by obcházel i ochranu proti soft-locku (např. `GettingUp` je nepřerušitelné právě proto, aby kontinuální Impacty nemohly Character zamknout).

Praktický důsledek: botí modul závisí jen na `SimInputs` + pohledu na svět (typově podmnožina `SimState` + resolved Track) a je čistě testovatelný ve Vitestu bez Rapieru — stejně jako je testovatelný `walkTrack` s Rapierem, když jde o integraci.

## 3. Navigace po Tracku

### 3.1 Waypointy: Checkpointy a Finish Zone

Resolved Track (`resolveTrack`) dává všechno potřebné: `checkpoints` (každý s `respawn: Vec3`, Gate s `order`), `finishZones`, `trackSpawn` pro startovní grid (`Track.ts:454`, `gateCheckpointPlans` v `Track.ts:616`). Přirozený route pro Race:

```
trackSpawn(botSlot) → checkpoint[order 0].respawn → … → checkpoint[N].respawn → finishZone.center
```

Checkpointy se aktivují průchodem Gatou z libovolné strany (`passesThroughGate`, `Gate.ts:113`) nebo vstupem do triggeru u starších Tracků (`Checkpoint.ts:24`) — bot nemusí trefit střed, stačí projít. `route()`/`jumpFrom()` helpery ve `walkTrack.ts:135` ukazují osvědčený tvar waypointu (`x`, `s`, `radius`, `jump`).

Poznámka k údržbě: waypointy odvozené z dat Tracku (ne z layout konstant v testu) se nerozbijí při editaci Tracku — stejnou mitigaci proti "křehkosti waypointů" doporučuje `testing-bots.md` §2.

### 3.2 Steering: seek + arrive (+ pursue pro souboj)

Klasické Reynolds steering behaviors ([Steering Behaviors For Autonomous Characters](https://www.red3d.com/cwr/steer/gdc99/)): **seek** (plnou rychlostí na cíl), **arrive** (zpomalení v rádiusu, aby bot neorbitoval kolem waypointu), **pursuit** (seek na predikovanou pozici pohyblivého cíle — pro honění hráče). Náš pohybový model (accelerate → drag → cap, Source tvary, `tuning/movement.ts:10`) bere wish-směr a zbytek řeší sám, takže steering = počítat `moveDirection` (případně škálovat jeho velikost pro arrive — všimni: `moveDirection` je "unit vector or zero" podle `SimInputs.ts:13`, takže zpomalení se dělá pulzováním/přerušováním, ne škálou; alternativa je arrive řešit jen přepnutím waypointu dřív).

Co vědomě NENÍ potřeba: A* ani navmesh. Track je lineární překážková dráha s Checkpointy; `walkTrack` dokazuje, že přímkové steering stačí na průchodnost geometrie ("cesta, kterou bot nenajde přímkou, nenajde ani hráč" — `walkTrack.ts:64`). Bot, který někde uvázne, je *signál o Tracku*, ne bug bota — pro dev nástroj cenná informace.

### 3.3 Větvené Tracky (forky)

Spin Cycle a Slip Stream mají po třech forcích. Strategie: v místě forku si bot seeded náhodou vybere větev a drží ji (waypoint sekvence per větev, odvozená z dat Tracku). Seedovaná volba znamená: reprodukovatelné ("seed 7 bere vždy levou"), a opakováním seedů vývojář pokryje všechny větve. Žádné hledání "nejlepší" větve — bot testuje feel, ne rychlost.

### 3.4 Pohyblivé překážky a timing

Klíčový poznatek: **Motion je čistá funkce Ticku** (CONTEXT.md: "A pure function of the Tick, so every Player sees the same pose without it being sent"; `movingSegmentPose` v `MovingSegment.ts`). Bot tedy nemusí timing *odhadovat* — může si spočítat budoucí pózu překážky přesně. Doporučení ve dvou úrovních:

1. **Tracer:** bot timing ignoruje (jde jako `walkTrack`, který chodí `atRest`). Překážky ho mlátí; vývojář vidí, jak Knockdown vypadá zvenčí, a bot se zvedne a jde dál. Překvapivě užitečné.
2. **Plný:** bot čte fázi nejbližšího Moving Segmentu a čeká na okno (waypoint s `waitUntil`, stejný idiom jako `testing-bots.md` §2 fáze B). Protože je to dev nástroj, čtení přesné fáze je legitimní — jen se k němu přidá reakční zpoždění 150–300 ms (§5), aby bot neprocházel s nelidskou přesností a testoval reálné okno.

### 3.5 Surface rozdíly (led, bláto, bounce)

Surface je vlastnost podlahy čtená z `staticSurfaceByHandle` (`RapierSimulation.ts:1192`) s konfigurací v `track/Surface.ts`. Co bot potřebuje vědět:

- **Led:** nízký grip (akcelerace/brzda), slabší odraz, pád může skončit Slipem; od ADR 0102 náraz v rychlosti 1+ u/s = Knockdown. Chování: žádné Dashování na ledě, širší arrive rádius (brzdná dráha), neprudké změny směru.
- **Bláto:** tvrdý speed cap (`0.4` top speed, ADR 0094), náhodný Slip při běhu/zatáčce/dopadu (ADR 0102). Chování: počítat s pomalým průchodem, po Slipu vstát a pokračovat — nic víc.
- **Bounce:** vrací dopadovou rychlost. Chování: neskákat zbytečně (dopad + skok se nevezmou oba, bere se větší — ADR 0094).
- **Conveyor:** stojí na Segmentu jako vektor proudu (`staticConveyors`, `RapierSimulation.ts:117`). Chování: kompenzovat drift přičtením opačného směru, nebo ho využít.

Všechny multiplikátory jsou data v `tuning/` + `Surface.ts` — bot je čte, neguessuje. Surface pod nohama bot zná z `groundColliderHandle` → stejné mapy jako sim (je to informace, kterou hráč "vidí" očima — led je vidět).

### 3.6 Pád, ragdoll, respawn: zotavení zdarma

Většinu zotavení dělá sim, ne bot:

- **Fall** → sim teleportuje na Respawn (`fall(respawnPoint)`), bot pozná změnu `respawnCount` (monotónní čítač, `CharacterState`) a přepne cíl na waypoint za posledním dosaženým Checkpointem (`checkpointIndex` ze snapshotu).
- **Ragdoll/GettingUp** → stavový automat se vrátí sám (`RAGDOLL_MIN/MAX_TICKS`, `GETUP_TICKS`); bot mezitím drží `IDLE_INPUTS` (pozná přes `isDownMotionState`, `CharacterStateMachine.ts:44`) a po návratu do `Controlled`/`Stagger` pokračuje.
- **Stagger/Sliding** → zmenšené `inputScale` (`MOTION_MODES`, `CharacterStateMachine.ts:83`); bot jede dál, sim ho zpomalí. Na `Sliding` (příliš strmý svah) nemá smysl bojovat — bot počká, až podmínka pomine.

Bot tedy nepotřebuje žádnou "respawn logiku" — jen *detekci*, že se Respawn stal, a návrat k route. To je i jádro tracer bulletu (§9).

## 4. Souboje a Survival

### 4.1 Kdy co: rozhodovací strom

Priorita (vyhodnocená na steering ticku 5–10 Hz):

1. **Jsem Held?** → Struggle (střídat `moveDirection` ~8×/s; 12 wigglů proti drainu plní meter za ~2 s — `tuning/fight.ts:103`). Pokud už Limp → nic (input je mrtvý, sim nese).
2. **Držím někoho?** (vlastní `grabbingId != null`) → nést k okraji (Survival) / do cesty překážky (Race); Spin, když je cíl hodu v dosahu; Hurl s mířením na tangentu.
3. **Soupeř v dosahu 1.8 a v kuželu ±60°?** (`HIT_RANGE`, `HIT_FACING_COS_MIN`) → Hit s chargí podle vzdálenosti/pohybu cíle (stojící cíl = krátká charge, běžící = delší, ať rána sedne), nebo Grab, když je soupeř u okraje / zády / po Knockdownu (Grab chytí i sraženého, CONTEXT.md).
4. **Soupeř blízko, ale mimo kužel?** → dotočit `facing` a přiblížit se (pursuit), Bump zdarma kontaktem (`BUMP_IMPULSE_SCALE = 0.6` — chůze strčí, Dash srazí).
5. **Jinak** → route (§3).

Grab vs Hit volba pro testování: obojí musí bot umět, protože vývojář testuje obojí. Jednoduché pravidlo stačí: Grab, když je soupeř do 1.8 a bot má cooldowny volné a soupeř stojí/záda; jinak Hit. Souboj na Race trati = zdržení soupeře; v Survival = pokus o shoz.

### 4.2 Hurl míření a Spin

Hurl letí po tangentě kruhu ± snap 45° směrem, kam grabber steers (`HURL_AIM_SNAP_DEG`). Bot: točit Spin, a když je tangenta ±45° od směru na okraj/jámu, pustit. Rychlost 3–10 podle wind-upu (`HURL_MIN/MAX_SPEED`), dolet 3–7 m na rovině (tabulka v `tuning/fight.ts:218`) — bot míří na cíl do ~5 m od okraje. Overspin limit 1 s na plné rychlosti (`SPIN_OVERSPIN_TICKS`) = bot nesmí točit donekonečna; jednoduché: pustit do konce wind-upu + 0.5 s.

### 4.3 Survival poziční hra

Arena (Cog Arena, Sky Rings): není cíl-route, je *pozice*:

- **Držet střed:** defaultní cíl = centroid arény / Start Segment; pursuit jen když je soupeř v "osobní zóně" (~4 m) nebo když vývojář testuje agresi.
- **Tlačit k okraji:** když bot nese soupeře (Grab) nebo ho honí, cíl = nejbližší okraj za soupeřem (soupeř mezi botem a okrajem). Hurl z ~5 m od okraje.
- **Nezabít sebe:** po Hurlu/whiffnutém Dashu se vrátit ke středu; nikdy nedashovat směrem k okraji (Dash zamyká Hit/Grab a končí Ragdollem do zdi — M6.1 "dash locks everything").
- **Cooldown na agresi:** po každém souboji N sekund jen poziční hra — jinak bot vypadá jako roj, ne soupeř, a netestuje se nic než chaos.

### 4.4 Napojení na wrestle automat

Bot čte ze serverového stavu (všechno replikované, `CharacterState` v `CharacterController.ts:84`): `grabbingId` (nesu), `heldByGrabberId` + `heldPhase` (nesen, Struggle vs Limp) + `holdEndsTick` (kolik času zbývá — bot-grabber podle toho načasuje donesení k okraji), `escapeProgress` (bot-held ví, jak blízko je k úniku). Grab immunita (`GRAB_IMMUNITY_TICKS` od postavení) = bot po puštění nezkouší okamžitě chytit znovu. Všechny přechody dělá `GrabHolds` ze vstupů — bot jen mačká a čte, stejně jako hráč čte HUD.

## 5. Věrohodnost: dost lidský na test feelu

Cíl není porazit vývojáře ani ho bavit — cíl je **být dost věrohodný, aby interakce testovala skutečný feel**. Z toho plyne:

- **Reakční zpoždění:** rozhodnutí 5–10 Hz (§1) + lag 150–300 ms na rychlé podněty (začátek Spinu soupeře, otevření okna v překážce). Lidský benchmark: ~200–250 ms na vizuální podnět. Bez lagu bot chytá rámcově dokonalé timingy a testuje nerealistický svět.
- **Chybovost (seedovaná):** občasný špatný odhad — přešlap na hraně, pozdní skok, whiffnutý Hit. Implementace: `slipRoll`-idiom, `botRoll(seed, id, tick)` vracející [0,1); prahy v konfiguraci bota (např. 5 % zahozený timing). Seed v logu = reprodukovatelnost (§8). Nikdy holý `Math.random()` — stejná disciplína jako sim (`testing-bots.md` §4).
- **Čitelnost:** bot se chová *čitelně* — běží viditelnou trasou, před Grabem se přiblíží, Spin je vidět. Žádné teleporty v chování (náhlé otočky o 180° bez přechodu), protože facing se integruje. Čitelnost = vývojář pozná, *co* bot zkouší, a posoudí, jestli hra reaguje správně.
- **Různé osobnosti levně:** agresivita (jak daleko pursuit), chargování Hitu, ochota dashovat — tři skaláry v konfiguraci bota stačí na "pasivní / normální / agresivní" bez tří implementací.

**Rubber-banding: ne.** Guma, která pomalému přidává a rychlému ubírá (klasická kritika Mario Kart AI, kde guma "cheapens the experience" a hráč nemůže ujet ani rychlejší postavou — viz např. [kritika rubber-banding AI v Mario Kart 64](https://www.mariowiki.com/MK2)), je herní design pro udržení napětí. Pro *dev nástroj* je kontraproduktivní: vývojář potřebuje vidět, jak se hra chová při skutečném náskoku/ztrátě — jak vypadá prázdná trať vpředu, jak dotahování zezadu. Guma by tenhle signál zničila. Místo gumy: seedovaná chybovost + volba počtu botů.

## 6. Fairness: informace a schopnosti

Protože bot je dev nástroj, nejde o "nepodvádět hráče" v herním smyslu — jde o to, aby **bot testoval stejnou hru, jakou hraje hráč**. Pravidla:

1. **Stejné schopnosti: garantuje input-level.** Bot prochází stejným `beginTick`, stejnými cooldowny, stejným pohybovým modelem, stejným wrestle automatem. Není cesty, jak by bot dostal jinou fyziku — je to strukturální, ne disciplinární.
2. **Viditelnost: pohled na svět = snapshot + Track.** Bot smí číst: vlastní plný stav (hráč ho vidí na HUD: cooldowny, `escapeProgress`, `holdEndsTick`), pozice/facing/motionState ostatních (hráč je vidí očima), resolved Track (geometrie, Checkpointy, Surface — všechno viditelné), Motion fázi (viditelná + deterministická, §3.4). Bot nesmí číst: cizí cooldowny a charge (hráč je nevidí), `slipRoll` budoucnosti (to je tahání osudu, ne informace), nic za zdí (bez line-of-sight — pro arény s překážkami; na otevřené trati irelevantní).
3. **Reakce: se zpožděním** (§5). Okamžitá reakce na změnu stavu je superschopnost, kterou hráč nemá.
4. **Replikace: bot je normální Character.** Žádné speciální entity, žádné `isBot` na drátě — tělo, animace, interpolace i zvuky tečou z `SimState.characters` (`frameLoop.ts` iteruje `serverRender.characters`), takže klient bota vykreslí, rozpohybuje i ozvučí přesně jako hráče, což je *žádoucí*: testuje se tím i rendering/interpolace/audio cesta pro cizí Characters. Pozor ale: jméno, barva, skin a klobouk se neberou ze simu, ale z prezentačních map rosteru ve snapshotu (`roster.names/colors/skins/hats` → `stage.setPlayerNames/Colors/Skins/Hats` → `remoteCharacterPool`/`nameplates`, `frameLoop.ts:311-319`). Server tedy musí botům syntetizovat záznamy v těchto mapách — jinak poběží v defaultní barvě a beze jména nad hlavou. Jediná viditelná stopa: nickname `BOT · <jméno>`. Roster tu má dvě role a bot patří jen do jedné: do prezentačních map ano, do Match-flow počtů (`connectedPlayers`, `everyoneLoaded`, …) ne (§1, §8).

## 7. Výkon: budget 30 Hz ticku

Rozpočet: server tickuje 30 Hz na mřížce (`tickScheduler.ts`, ADR 0109), tj. ~33 ms na tick. Měřeno: horká cesta serveru jsou Character sweeps, ne Moving Segments (M13 výsledky v CLAUDE.md); botí logika je proti tomu nula.

- **Rozhodování 5–10 Hz:** steering + priority strom běží každých 3–6 ticků. Důvod není jen CPU, ale i věrohodnost (§5) — a stabilita: rozhodnutí se nemění uprostřed chargování Hitu.
- **Input assembly 30 Hz:** každý tick se z posledního rozhodnutí + aktuálního stavu poskládá `SimInputs` (držet/pustit tlačítko, integrovat `facing`). Je to pár aritmetických operací na bota.
- **Měření:** `DONTFALL_PERF=1` tick log (`apps/server/src/match/tickPerf.ts`) ukáže cenu botů na reálném ticku; `bench:sim` baseline bez botů už existuje. Požadavek: 3 boti < 1 ms/tick na dev stroji — jinak je něco špatně (typicky zbytečné alokace nebo čtení Rapier světa místo snapshot stavu).
- **Kdy se to vyplatí:** vždycky u 1–3 botů. Škálování na 11 botů (plná arena) by chtělo profilovat, ale to není zadání — zadání je soupeř pro jednoho vývojáře.

Poznámka: bot čte serverový stav přímo (referencí), ne serializovaný snapshot — žádný JSON parse na botí cestě.

## 8. Dev-only zapojení (místo produktové části)

Boti se nikdy nedostanou do produkčního flow. Návrh:

- **Zapnutí:** `DONTFALL_BOTS=N` (N = 1–3), precedent `DONTFALL_PERF=1` (`matchRuntime.ts:67`). Alternativa pro jemnější práci: `?bots=2` na dev klientovi, který to předá lokálnímu serveru — ale env flag stačí na začátek a nejde omylem zapnout v produkci.
- **Seed:** `DONTFALL_BOT_SEED=S`. Všechna botí náhoda (volba větve, chybovost, timing) teče z `botRoll(S, botId, tick)` — `slipRoll`-idiom. Seed se loguje při startu Match serveru; stejný seed + stejná hra vývojáře = stejní boti.
- **Lobby/Match flow:** boti jsou neviditelní pro Match mašinerii — nepočítají se do `connectedPlayers`, `playersToStart`, `everyoneLoaded`, `standingsConfirmed` (§1). Viditelní jsou jen v rosteru jako `BOT · <jméno>` (jinak by vývojář nevěděl, s kým hraje) a ve výsledcích (jinak by chyběli v rankingu, který se testuje). Host startuje sám; boti jsou "vždy ready".
- **Spawn/kill za běhu:** minimum je počet z env při startu serveru. Užitečný upgrade (až po traceru): dev-only zpráva nebo lokální HTTP endpoint (`/debug/bots?add=1&remove=bot-2`) — ale pozor, přidání Characteru mid-Round mění iteraci simu; čistší je spawn jen v LOBBY/LOADING. Pro začátek stačí restart serveru.
- **Kódově odděleně:** `apps/server/src/debug/bots/` (nebo `scripts/`), importované jen když je flag nastavený. Žádné `isBot` v `packages/shared` — sim o botech neví, vidí jen inputy.

### Debug role nad rámec soupeře

Stejná infrastruktura (bot = producent `SimInputs` bez socketu) dá zadarmo užitečné pomocníky pro ruční testování — každý je pár řádků:

| Role | Chování | Na co |
|---|---|---|
| `idle` | stojí (`IDLE_INPUTS`) | živý terč na Bump/Hit/Grab/Hurl; test Elimination credit |
| `runner` | běží rovně, občas skočí | už existuje jako `scriptedInput` (`scripts/benchInputs.ts`) — vzít přímo |
| `chaos` | seedované náhodné inputy | soak: shozy, Ragdoll/Held/Limp kombinace, hledá zaseknuté stavy (souvisí s `testing-bots.md` §4.2, ale interaktivně) |
| `sparring` | jen souboj, nenaviguje | stojí v aréně, točí se na hráče, Hit/Grab/Struggle — testverkaní souboje bez běhání |
| `full` | §3 + §4 | skutečný soupeř; jádro tohoto researchu |

Volba role: `DONTFALL_BOTS=full,sparring,idle` (seznam místo počtu — počet je pak délka seznamu).

## 9. První krok a iterace

Každý krok je samostatně užitečný a samostatně otestovatelný proti dev serveru s jedním prohlížečem:

1. **Idle bot (tracer infrastruktury).** `DONTFALL_BOTS=idle` spawne Character bez socketu, stojí, replikuje se, jde do něj strčit a jde ho Hitnout/Grabnout. Hotovo = vývojář vidí `BOT` v aréně a Elimination credit funguje. Testuje: spawn sloty, oddělení sockets/characters (§1), replikaci.
2. **Waypoint runner.** `full` bez skoků/souboje: Checkpointy → Finish, po Fallu Respawn a pokračování, po Ragdollu vstát a pokračovat. Hotovo = bot dokončí base race (v klidu; s Motion co nejdál dojde — kde uvázne, je informace o Tracku). Testuje: route z dat Tracku, seek/arrive, detekci respawnu.
3. **Skoky, Dash, timing.** `jumpFrom` idiom z `walkTrack`, Dash na rovinkách (nikdy na ledě / k okraji), čekání na Motion okna s reakčním zpožděním. Hotovo = bot dokončí base race se zapnutým Motion. Testuje: timing oken, Surface chování.
4. **Souboj proti hráči.** Rozhodovací strom §4.1, Hit s chargí, Grab + donesení + Hurl, Struggle při držení. Hotovo = 5minutový Survival 1v1, kde bot srazil vývojáře aspoň jednou a vývojář bota taky. Testuje: celý feel souboje z obou stran.
5. **Survival poziční hra.** Držet střed, tlačit k okraji, nepadat sám. Hotovo = bot přežije průměrnou arénu > 60 s proti pasivnímu hráči a < 3 min proti aktivnímu. Testuje: arény samotné (kde se dá kempit, odkud se padá).

Později, jen když to bude bolet: forky-větve per seed (§3.3), osobnosti (§5), spawn/kill za běhu (§8).

---

## 10. Implementační architektura: jak boty napsat

§1–§9 říkají *co* má bot dělat a *kam* se zapojí. Tahle část říká *jaký kód* to má být: jakou kostru rozhodování zvolit (§10.1), jak vrstvit pipeline (§10.2), jaké soubory a rozhraní napsat (§10.3), jak držet determinismus (§10.4) a jak botí logiku testovat (§10.5).

### 10.1 Rozhodovací framework: prioritní seznam jako kostra, FSM v listech

**Náš případ:** 1–3 boti, plné chování (route + timing + souboj + Survival), rozhodování 5–10 Hz, a uživatel, který je zároveň ladicí — vývojář-tester potřebuje z logu vyčíst *proč bot udělal X*, přidat nové chování bez rozbití starých a nikdy neřešit framework, který nemá co nést. Čtyři kandidáti:

**FSM (konečný automat).** Stavy + přechody; Robert Nystrom ukazuje, jak FSM zachraňuje před změtí booleaních flagů, a hned vedle zavádí hierarchické FSM a zásobníkové automaty pro chvíli, kdy plochý stroj přestane stačit ([State](https://gameprogrammingpatterns.com/state.html)). Pro celého bota to znamená stavy jako `SeekCheckpoint`, `ChasePlayer`, `ChargeHit`, `CarryVictim`, `SpinUp`, `Struggle`… — a každé nové chování přidává přechody do a ze stavu, se kterými souvisí. Sekvencování (charge→release, carry→Spin→Hurl) umí FSM nejlíp ze všech — proto patří *do listů*, ne na vrchol: jeden miniaturní stroj na sekvenci, nikdy jeden stroj na celého bota.

**Behavior tree.** Colledanchise & Ögren staví BT na dvou vlastnostech — modularitě a reaktivitě — a kniha ukazuje, jak BT souvisejí se staršími přepínacími strukturami a v mnoha případech je zobecňují ([Behavior Trees in Robotics and AI](https://arxiv.org/abs/1709.00084), abstrakt). Proč ne teď: naše chování má pět větví (§4.1 má pět pravidel), reaktivita s plným přehodnocením každých 3–6 ticků je zadarmo už v seznamu, a BT runtime (uzly Sequence/Selector, tick sémantika, blackboard) je framework, který při pěti větvích nemá co nést — zatímco "proč X" by vyžadovalo trasování stromu. Migrační cesta zůstává otevřená: prioritní seznam je degenerovaný BT (Selector nad bezestavovými uzly), a až pravidel bude třicet a začnou se navzájem mlátit, je to přesně ten okamžik, pro který BT vznikly.

**Utility AI.** Každá možnost dostane skóre z response curves a vítězí maximum — Dave Mark, *Behavioral Mathematics for Game AI* (Course Technology PTR, 2009) a přednáška s Kevinem Dillem [Improving AI Decision Modeling Through Utility Theory](https://www.gdcvault.com/play/1012410/Improving-AI-Decision-Modeling-Through) (GDC 2010 AI Summit; Markova architektura se jmenuje Infinite Axis Utility System, IAUS). Síla utility je plynulá arbitráž, když možnosti skutečně soutěží *na stupnici* — jak moc chci A proti B. Proč ne: naše priority jsou striktní (Held → Struggle vždy, nikdy "trochu Struggle, trochu route"), vývojář-tester nepotřebuje plynulost, ale jeden čitelný důvod, a "proč X" u utility znamená rozbor skóre všech možností — ladicí nástroj navíc. Levnou variabilitu bez utility aparátu dávají tři skaláry osobnosti z §5.

**Prioritní seznam (§4.1) — doporučeno jako kostra.** Uspořádané if/then vyhodnocené shora dolů, první shoda vítězí. Intelektuální precedent: Brooksova subsumption architektura — vrstvy chování s arbitráží podle priority, kde vyšší vrstva přebírá (subsumes) řízení od nižší ([A Robust Layered Control System for a Mobile Robot](https://people.csail.mit.edu/brooks/papers/AIM-864.pdf), MIT AI Memo 864, 1986). Náš seznam je totéž v nejmenším měřítku: Held přebírá Carry, Carry přebírá Fight, Fight přebírá route.

| Kritérium | Prioritní seznam | FSM na vrcholu | BT | Utility |
|---|---|---|---|---|
| Implementace | ~50 řádků, žádný framework | Stavy + přechody, roste s každým chováním | Runtime uzlů + blackboard | Skórování + response curves |
| "Proč bot udělal X" | Jméno prvního sedícího pravidla — jeden řádek logu | Historie přechodů | Trasování stromu | Rozbor skóre všech možností |
| Přidání chování | Vložit pravidlo na správnou prioritu | Dopsat přechody do/z okolních stavů | Připojit podstrom (nejčistší ze všech) | Přidat možnost + křivky, přeladit váhy |
| Riziko | Oscilace mezi pravidly (řeší hystereze/latch v BotState) | Křehkost přechodů při růstu | Režie bez užitku při pěti větvích | Neladitelnost pro testera feelu |

**Rozhodnutí: prioritní seznam jako kostra; chování, která potřebují sekvenci, drží miniaturní explicitní stav v BotState** (Nystromův FSM v nejmenším měřítku: `fight: approach | charge | recover`, `carry: haul | spin | release`). A tvar kopíruje repo precedens `MOTION_MODES` (`CharacterStateMachine.ts:83` — co stav *dělá*, je řádek dat, ne větev kódu): pravidla jako uspořádané pole pojmenovaných řádků `{ name, when, intend }`; přidat chování = přidat řádek na správnou prioritu; zalogovat rozhodnutí = jméno pravidla, které sedlo.

### 10.2 Vrstvení pipeline

Čtyři vrstvy. Hranice mezi nimi jsou typy z §10.3, ne volání přes síť ani zprávy — všechno běží v jednom ticku na serveru.

| Vrstva | Vstupy | Výstupy | Frekvence | Kde žije stav |
|---|---|---|---|---|
| 1. Vnímání (`perception`) | `SimState` (snapshot serverového simu), resolved Track, `RoundRules`, Tick, seed | `BotView` — jen to, co bot smí vidět (§6.2) | S rozhodováním (5–10 Hz) | Nikde — čistá funkce |
| 2. Rozhodování (`policy`) | `BotView` + `BotContext` (Track statics, pravidla Round type, RNG) + `BotState` | `BotIntent` (záměr: `kind` + cíl) + jméno pravidla pro log | 5–10 Hz (každý 3.–6. tick) | `BotState` (mutabilní, mezi ticky) |
| 3. Steering (`steering`) | `BotIntent` + čerstvý `BotView` | wish `moveDirection` (unit XZ) + cílový yaw | 30 Hz z 5Hz intentu | Nikde — čistá funkce |
| 4. Skladba inputu (`assemble`) | Steering + `BotIntent` + `BotState` + vlastní řádek snapshotu (`grounded`!) | `SimInputs` | 30 Hz (každý tick) | Čítače držení v `BotState` |

**Proč steering na 30 Hz, když rozhodnutí na 5–10 Hz:** intent říká *koho/kam* ("hoň hráče B"), steering *jak přesně teď* — a hráč B se hýbe i mezi rozhodnutími. Pursuit na 30 Hz z 5Hz intentu je pořád levný (pár vektorových operací) a nedělá schodovité zatáčky. Primitivy jsou Reynoldsovy ([Steering Behaviors](https://www.red3d.com/cwr/steer/gdc99/)): **seek** (plnou na bod), **arrive** (přepnutí waypointu dřív / pulzování — všimni, že `moveDirection` je unit vektor nebo nula, takže zpomalení škálou nejde, `SimInputs.ts:12`), **pursuit** (seek na predikovanou pozici — cílová pozice + rychlost × čas doběhu), **wait** (nula + držení facingu), plus **míření** (yaw na cíl pro Hit/Grab kužel).

**Co přesně smí `BotView` číst** (§6.2, rozvedeno na pole): vlastní `CharacterSnapshot` celý (cooldowny, `escapeProgress`, `holdEndsTick` — hráč to vidí na HUD); ostatní Characters jen `position`/`velocity`/`facing`/`motionState` + `grabbingId`/`heldByGrabberId` (nesené tělo a Spin jsou vidět očima); Track: `checkpoints`, `finishZones` (`resolveTrack.ts:69,76`), `movingSegments` + Tick pro `movingSegmentPose` (`simulation/MovingSegment.ts:61`), Surface pod nohama (stejnou cestou jako sim — hráč led vidí). Nesmí: cizí `hitCooldownMs`/`hitChargeMs`/`grabCooldownMs`, cokoli z budoucnosti `slipRoll`, a — vědomé zjednodušení k doplnění, až bude aréna se zdmi — zatím žádný line-of-sight (na otevřené trati a dnešních arénách irelevantní).

**Příklad toku — "bot vidí hráče u okraje → Grab → donesení → Hurl":**

1. Vnímání postaví `BotView`: hráč B na 1.5 u v kuželu ±60° (`GRAB_RANGE`, `GRAB_FACING_COS_MIN`, `tuning/fight.ts:81,84`), za ním okraj (vzdálenost k okraji z dat Tracku), bot v `Controlled`, Grab ready (`grabCooldownMs === 0`).
2. Rozhodování: pravidla 1–2 nesedí (bot nikoho nedrží, nikdo nedrží jeho), pravidlo 3 sedí → `BotIntent { kind: 'grab', targetId: 'B' }`, do logu jméno pravidla. `BotState.fight = 'approach'`.
3. Steering: pursuit na B + yaw na B.
4. Skladba: `moveDirection` z pursuit, `grabHeld` hrana v ticku, kdy je B v dosahu a kuželu; `facing` integrovaný k yaw na B.
5. Sim chytí (`GrabHolds`) — botův snapshot řádek ukáže `grabbingId: 'B'`, `holdEndsTick`. Příští rozhodnutí: pravidlo 2 → `BotIntent { kind: 'carry', target: okraj-za-B }`; steering seek na bod 5 m před okrajem (Dolet Hurlu 3–7 m, `tuning/fight.ts:218`); skladba drží pomalejší tempo (sim ho zpomalí sám přes `GRAB_CARRY_SPEED_MULTIPLIER`, bot jen nespěchá).
6. V dosahu hodu: `BotState.carry = 'spin'` → intent `spin`, skladba drží `hitHeld` (Spin); když je tangenta ±45° od směru na okraj (`HURL_AIM_SNAP_DEG`), pustit → Hurl. `carry = 'release'`, cooldown na agresi (`BotState.nextAggressionTick`) — pak zase route.

### 10.3 Konkrétní layout kódu

Nový adresář **`apps/server/src/debug/bots/`** (§8; dnes neexistuje — server má `match/`, `net/`, `server/`, `track/`). `packages/shared` o botech neví — bot jen čte shared typy (`SimInputs`, `CharacterSnapshot`, tuning) a volá shared čisté funkce (`slipRoll`, `movingSegmentPose`, vektorovou matematiku).

```
apps/server/src/debug/bots/
  types.ts       BotView, BotContext, BotIntent, BotState, Role, BotConfig (osobnost: 3 skaláry z §5)
  perception.ts  buildView(snapshot, track, rules, tick): BotView — čistá funkce
  steering.ts    seek/arrive/pursuit/wait + aimYaw — čisté funkce nad Vec3
  policy.ts      RULES (uspořádané řádky { name, when, intend }, precedens MOTION_MODES)
                 + decide(view, ctx, state): { intent, ruleName }
  roles.ts       Role jako variance nad policy, ne pět implementací (níže)
  assemble.ts    assembleIntent(intent, steer, view, state, tick): SimInputs (+ čítače držení)
  facing.ts      integrateFacing — mirror pravidla nextModelYaw (klient: modelFacing.ts:38),
                 s TICK_DT; turnScale = GRAB_TURN_SPEED_MULTIPLIER při nesení
  bots.ts        class Bot { decide/inputFor }, parseBotsEnv (DONTFALL_BOTS), createBots + seating
  tuning.ts      Server-local knoby botů — NE do packages/shared/src/tuning (to je feel simu;
                 shared o botech neví, §8). Bot shared tuning (fight/movement/character) jen čte.
  *.test.ts      Vedle kódu, styl server testů (§10.5)
```

**Rozhraní (kostry, ne final API):**

```ts
// types.ts
interface BotView {
  tick: number;
  self: CharacterSnapshot;                    // vlastní plný řádek (CharacterController.ts:84 + progress pole)
  others: Pick<CharacterSnapshot, "position" | "velocity" | "facing" | "motionState" | "grabbingId" | "heldByGrabberId">[]; // §6.2
  route: { checkpoints: Vec3[]; finish: Vec3 | null };  // z ResolvedTrack, předpočítáno v BotContext
  ground: SurfaceId | null;                   // Surface pod nohama
  motionPhase: (segment: number, tick: number) => MotionPose; // movingSegmentPose obalená
}
interface BotIntent {
  kind: "route" | "chase" | "fight" | "grab" | "carry" | "spin" | "struggle" | "wait" | "recover";
  target: Vec3 | null;                        // kam (bod) — pro chase/fight/carry cíl dopočítá steering
  targetId: string | null;                    // koho (Character id)
  holdButton: "hit" | "grab" | "dash" | "jump" | null; // co skladba drží
}
interface BotState {                          // mutabilní, žije v Bot, mezi ticky
  currentYaw: number;                         // integrovaný facing
  nextDecisionTick: number;                   // cadence 5–10 Hz
  routeIndex: number; branchSeed: number;     // progress po route + volba větve (§3.3)
  fight: "approach" | "charge" | "recover"; chargeStartTick: number;
  carry: "haul" | "spin" | "release";
  jumpHoldTicks: number; pendingJump: boolean; // walkTrack idiom (walkTrack.ts:106)
  lastWiggleYaw: number | null;               // Struggle wiggle stav
  nextAggressionTick: number;                 // cooldown na agresi (§4.3)
  lastRule: string;                           // "proč" pro log
}
type Role = "idle" | "runner" | "chaos" | "sparring" | "full"; // §8
```

**Role jako variance (§8):** jedna `policy.ts`, pět konfigurací — která pravidla jsou aktivní + osobnostní skaláry: `idle` = všechna pravidla vypnutá (vždy `wait` → `IDLE_INPUTS`); `runner` = jen route + skoky (bere `scriptedInput` z `scripts/benchInputs.ts` přímo, jak §8 navrhuje); `chaos` = seedovaný náhodný intent každých N ticků; `sparring` = jen fight/carry/spin/struggle, žádná route; `full` = všechno. Nová role = nový řádek v `roles.ts`, nikdy nová implementace.

**Hook do matchLoop** (vedle `matchLoop.ts:217`, kde se dnes staví `tickInputs` ze socketů):

- **Čte:** jeden `rt.simulation.snapshot()` navíc na začátku `runTick`, jen když boti existují (`rt.bots.size > 0`) — stejný objekt pro všechny boty; cenu ukáže `DONTFALL_PERF=1` tick log (`match/tickPerf.ts`). Levnější cesta není: `snapshot()` je jediný veřejný čtenář stavu (M4.5 smazal nepoužívané accessors) a bot čte stav ticku N, viz §10.4.
- **Zapisuje:** `tickInputs[bot.id] = bot.inputFor(view, thisTick)` hned pod socketovou smyčku; pro botí id nastavit `lastInputTick` na `thisTick` (jinak by zůstal 0 — neškodné, bot nereconciluje, ale nepoctivé; `matchLoop.ts:497`).
- **Seating:** v `buildSimulationFor` vedle loopu přes `lobbyPlayers` (`matchRuntime.ts:812`) — slot `lobbyPlayers.size + botIndex` do `trackSpawn(track, slot, library)`; botí id nikdy do `lobbyPlayers`, `sockets`, `loaded` ani `standingsReady` (§1, §8).
- **Rebuild:** `rebuildSimulation` (`matchRuntime.ts:871`) zahazuje svět — botí `BotState` (route progress, `respawnCount` baseline) se resetuje s ním, jinak první rozhodnutí po rebuildu čte mrtvý stav.
- **Roster řádky** (`BOT · <jméno>`, §6) se syntetizují až při stavbě `lobbySnapshot.players` (`matchLoop.ts:580`), nikdy insertem do `rt.lobbyPlayers` — tu čte seating i Match flow.

### 10.4 Determinismus a pořadí vůči ticku

**Bot čte stav ticku N a píše inputy pro N+1.** V `runTick` se `tickInputs` staví pro `thisTick = serverTick + 1` (`matchLoop.ts:176,216`) a teprve pak běží `simulation.tick(tickInputs, phase)` (`RapierSimulation.ts:1066`). Tři důvody, proč ne číst-a-psát tentýž tick:

1. `snapshot()` je platný jen *mezi* ticky — `world.step()` svět mutuje, takže "aktuální stav" uprostřed ticku je polovina před stepem a polovina po něm.
2. Kontrakt `(state, inputs) -> state` (ADR 0003/0005) pak drží i s boty: `input[N+1]` je čistá funkce (`state[N]`, `BotState`, seed) — replayovatelná a laditelná.
3. Je to stejná pozice, v jaké jsou síťoví hráči: jednají podle posledního snapshotu, který viděli, nikdy podle ticku, který se právě simuluje.

**Seedovaná náhoda: žádná nová RNG — reuse `slipRoll`.** `slipRoll(id, tick)` (`simulation/slipRoll.ts`, exportovaný z indexu shared) je deterministický tah z `[0,1)` nad id a tickem; bot volá `slipRoll(`${seed}:${botId}:${purpose}`, tick)` — seed z `DONTFALL_BOT_SEED` (default 1, vždy zalogovat), `purpose` odděluje proudy (volba větve vs chybovost vs timing), aby změna jednoho nemíchala ostatními. Nikdy `Math.random()` ani `Date.now()` v botí cestě — stejná disciplína jako sim (hlavička `slipRoll.ts`: náhoda z hodnot, které mají obě strany, jinak je každý hod neshoda).

**Co se loguje pro repro bugů** (při bootu Match serveru, jeden řádek): seed, seznam rolí (`DONTFALL_BOTS` po parsování), Track id + revision, `BOT_POLICY_VERSION` (konstanta v `bots/tuning.ts`, bumpovaná při každé změně pravidel — stopa z minulé verze proti novým pravidlům je jinak falešný diff). Volitelně decision trace (`DONTFALL_BOT_TRACE=1`: `tick, bot, rule, intent`) — odpověď na "proč bot udělal X" bez debuggeru.

### 10.5 Jak testovat botí logiku samotnou

Princip: **bot je nástroj na testování feelu — jeho vlastní testy drží kontrakt, ne chytrost.** Levné testy, které přežijí přeladění; chytrost ověřuje ruční playtest podle definic hotova v §9.

**Unit (vitest, bez Rapieru)** — `decide()`, `assembleIntent()`, steering a `perception.buildView` jsou čisté funkce nad daty, takže test nepotřebuje fyziku, jen ručně postavený `BotView`:

- fixture scénáře: "hráč u okraje v kuželu → intent `grab` na něj"; "Held → `struggle`"; "`grabbingId != null` → `carry` k okraji"; "nikdo blízko → `route` na další Checkpoint"; "po Hurlu → cooldown na agresi (`nextAggressionTick`)".
- skladba: charge drží `hitHeld` právě `HIT_CHARGE_MAX_TICKS` a pak pustí; `pendingJump` čeká na `grounded` (walkTrack idiom); facing integrace nikdy nepřekročí `FACING_TURN_SPEED_MAX * TICK_DT` na tick a při nesení škáluje `GRAB_TURN_SPEED_MULTIPLIER`.
- steering: arrive přepne waypoint v rádiusu; pursuit vede pohyblivý cíl (cíl + rychlost × čas doběhu).

Styl a místo: `apps/server/src/debug/bots/*.test.ts`, vedle kódu — server testy takhle žijí všude (`apps/server/src/match/*.test.ts`, `server/*.test.ts`) a jejich idiom je čistá funkce + falešný runtime objekt (precedens `SaveRuntime`/`CloseRuntime` v `matchLoop.ts:47,116`, testované ve `matchLoop.test.ts` bez socketů).

**Replay/regression proti nahrané stopě** — seed + inputy hráče + decision trace z §10.4 se přehrají headless proti reálnému `RapierSimulation` v server testu (precedens: server testy sim staví, např. `matchRuntime.test.ts`) a porovná se trace; drift = regrese. Levnější varianta ve stylu `walkTrack`: "runner dojde k Checkpointu 2 za <N s" s reálným Rapierem, bez socketů.

**Co nechat na ručním playtestu** (netestovat vůbec): že bot dokončí trať / vyhraje Survival (křehké, závislé na Rapieru a tuningu — rozbije se při každém feel-tuning passu); timing oken na Motion; "chytrost" voleb (Grab vs Hit); cokoli s vizuálem (čitelnost, §5). Hranice je ostrá: test drží *smlouvu mezi vrstvami* (intent → input, pravidlo → intent), playtest *jestli to hraje dobře*.

## Zdroje

**Repo (primární):**
- `packages/shared/src/simulation/SimInputs.ts` — input interface, held snapshot
- `packages/shared/src/simulation/RapierSimulation.ts` (`tick`, `effectiveInput`, `addCharacter`, `findNearestInCone`) — sim step, input lock, cone targeting
- `packages/shared/src/simulation/CharacterStateMachine.ts` (`MOTION_MODES`, `isDownMotionState`) — co který stav dělá
- `packages/shared/src/simulation/CharacterController.ts` (`CharacterState`, `facing` mirror) — replikovaný stav
- `packages/shared/src/simulation/character/InteractionController.ts`, `HitController.ts`, `GrabHolds.ts` — souboj z obou stran
- `packages/shared/src/tuning/fight.ts`, `tuning/movement.ts` — všechny range/cone/cooldown/rychlostní konstanty
- `packages/shared/src/track/Track.ts` (`trackSpawn`, `gateCheckpointPlans`), `Gate.ts` (`passesThroughGate`), `Checkpoint.ts` — route data
- `packages/shared/src/track/walkTrack.ts` — existující scripted hráč (steering, `pendingJump`, `atRest`, `standOn`)
- `packages/shared/src/simulation/slipRoll.ts` — deterministický tah, idiom pro botí náhodu
- `packages/shared/src/net/protocol.ts`, `apps/server/src/net/inputRouter.ts` (`takeFor`), `apps/server/src/match/matchLoop.ts:163` (`runTick`), `matchRuntime.ts:819` (spawn) — kam se bot zapojí a co nesmí rozbít
- `scripts/benchInputs.ts` (`scriptedInput`) — hotový `runner` bot
- `docs/research/testing-bots.md` — vymezení: automatizované testování vs interaktivní soupeř
- `CONTEXT.md` — Motion jako čistá funkce Ticku, Grab/Held/Struggle/Limp/Spin/Hurl slovník

**Repo (primární, §10 navíc):**
- `packages/shared/src/state/SimState.ts` (`SimState`, `CharacterSnapshot`) — co bot čte
- `packages/shared/src/simulation/MovingSegment.ts` (`movingSegmentPose`) — timing jako čistá funkce Ticku
- `packages/shared/src/track/resolveTrack.ts` (`checkpoints`, `finishZones`, `movingSegments`) — route data
- `packages/shared/src/tuning/character.ts` (`FACING_TURN_RATE`, `FACING_TURN_SPEED_MAX`), `tuning/clock.ts` (`TICK_DT`) — facing integrace
- `apps/client/src/render/modelFacing.ts` (`nextModelYaw`) — pravidlo, které botí facing mirroruje
- `apps/server/src/match/matchLoop.test.ts`, `apps/server/src/match/matchRuntime.test.ts` — styl server testů (čisté funkce, falešné runtime objekty, sim bez socketů)

**Externí (primární):**
- [Craig Reynolds — Steering Behaviors For Autonomous Characters](https://www.red3d.com/cwr/steer/gdc99/) — seek, arrive, pursuit; základ botího pohybu
- [MarioWiki — kritika rubber-banding AI](https://www.mariowiki.com/MK2) — proč guma zkresluje feel a proč tu není
- [Michele Colledanchise & Petter Ögren — Behavior Trees in Robotics and AI: An Introduction](https://arxiv.org/abs/1709.00084) — modularita a reaktivita BT, vztah k starším přepínacím strukturám (§10.1: proč BT až při růstu)
- [Dave Mark & Kevin Dill — Improving AI Decision Modeling Through Utility Theory](https://www.gdcvault.com/play/1012410/Improving-AI-Decision-Modeling-Through) (GDC 2010 AI Summit) + Dave Mark, *Behavioral Mathematics for Game AI* (Course Technology PTR, 2009) — utility AI a IAUS (§10.1: proč ne skórování)
- [Robert Nystrom — State](https://gameprogrammingpatterns.com/state.html) (*Game Programming Patterns*, kap. FSM/hierarchické FSM) — (§10.1: FSM do listů, ne na vrchol)
- [Rodney Brooks — A Robust Layered Control System for a Mobile Robot](https://people.csail.mit.edu/brooks/papers/AIM-864.pdf) (MIT AI Memo 864, 1986) — subsumption: vrstvy s prioritní arbitráží (§10.1: precedent prioritního seznamu)
