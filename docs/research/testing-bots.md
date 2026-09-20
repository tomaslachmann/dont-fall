# Boti na testování

*Research, 2026-09-20. Otázka: jak správně udělat boty na testování pro DON'T FALL.*

## TL;DR

Repo už má tři ze čtyř stavebních kamenů hotové a čtvrtý je z poloviny napsaný.
Nestavět žádný nový framework — poskládat z existujícího:

| # | Co | Stav v repu | Doporučení |
|---|---|---|---|
| 1 | Headless klienti / load-test | `FaithfulClient` v `tickAddressedInput.integration.test.ts` je prototyp bota přes reálný socket | **Postavit první.** Vytáhnout do `scripts/` jako load harness pro 12 klientů + metriky. Malá práce, velký přínos. |
| 2 | Scripted playtest | `walkTrack.ts` + `baseRace.test.ts` + `standOn` fungují, ale chodí jen po Tracku *v klidu* | **Rozšířit druhé.** Chůze se zapnutým Motion a napojení na CI jako regresní test hratelnosti. |
| 3 | E2E browser boti | Ad-hoc raw CDP skripty při live-verifikaci, nic commitnutého; `render-thumbnails.ts` ukazuje pattern | **Později, až bude potřeba.** Playwright místo raw CDP, jen na pár kritických cest (Lobby → start → Results). |
| 4 | Chaos / fuzz boti | `scriptedInput` (bench) a `slipRoll` (deterministický tah) existují; fuzzing sim stepu nikde | **Průběžně, levně.** Seeded fuzz `sim.tick` ve Vitestu; soak test jako vedlejší produkt botů z bodu 1. |

Co výslovně **nedělat**: nekupovat/nezavádět k6 ani Artillery (herný protokol s tick-addressed inputy se v generickém load nástroji píše hůř než ve vlastním Node klientovi, který importuje `@dont-fall/shared` a má protokol typově zadarmo), a nepsat AI, která „hraje chytře" (navigace po Tracku je drahá údržba s malou výpovědní hodnotou proti scripted chůzi).

---

## 0. Inventura: co už v repu je

Než cokoli nového — tohle všechno už existuje a každý návrh níže z toho vychází:

- **Čistý sim step.** `RapierSimulation.tick(inputs, phase)` v `packages/shared/src/simulation/RapierSimulation.ts` je čistá funkce `(state, inputs) -> state` (ADR 0003/0005). Běží identicky na serveru i v predikci klienta. Vstupy jsou `SimInputs` (`packages/shared/src/simulation/SimInputs.ts`): `moveDirection` + držení tlačítek + `facing`. Tlačítka jsou *held*, ne hrany — vstup je prostý snapshot, který jde replayovat.
- **Deterministický tah místo RNG.** `slipRoll(id, tick)` (`packages/shared/src/simulation/slipRoll.ts`) kreslí z `(Character id, Tick)`, protože `Math.random()` by každou minci udělal mispredikcí. Jakýkoli bot, který má dávat reprodukovatelné výsledky, musí ctít stejné pravidlo: seedovaný zdroj, nikdy holý `Math.random()`.
- **Protokol je JSON přes WebSocket a typovaný z jednoho místa.** `packages/shared/src/net/protocol.ts`: `welcome` → `input {tick, input}[]` s redundantním tailem (ADR 0021) → `snapshot` s `commandQueueDepth`, `serverTimeMs`, ack přes `CharacterSnapshot.lastInputTick` (ADR 0013). Server konzumuje vstup adresovaný Tickem, nikdy FIFO (ADR 0027, `apps/server/src/net/inputRouter.ts`). Server tickuje na mřížce přes `tickScheduler.ts` (ADR 0109), ne na `setInterval`.
- **Zvyk měřit.** `pnpm bench:sim` (`scripts/bench-simulation.ts`) měří cenu ticku na base race s 1/4/12 scripted Characters (`scripts/benchInputs.ts`, `scriptedInput` — de facto první bot v repu) a `DONTFALL_PERF=1` zapíná tick log na Match serveru (`apps/server/src/match/tickPerf.ts`). Load-test boti se mají napojit na tyhle metriky, ne si vymýšlet vlastní.
- **Headless síťový harness s virtuálním časem.** `apps/client/src/net/predictionRegression.harness.test.ts` řídí *skutečný* `PredictionLoop` proti autoritativní simulaci přes deterministický síťový model. Důkaz, že predikce/reconcile jde testovat bez prohlížeče.
- **Šablona headless klienta přes reálný socket.** `apps/server/src/net/tickAddressedInput.integration.test.ts` obsahuje `FaithfulClient`: reálná `RapierSimulation` + ping/pong time sync + tick seeding proti reálnému timer-driven `startServer` přes `ws` na loopbacku, na wall-clocku. To je z 80 % hotový bot z bodu 1 — chybí mu jen vytažení ze `.test.ts` do znovupoužitelného modulu a metriky.
- **Scripted chůze.** `packages/shared/src/track/walkTrack.ts` (waypoint walker + `standOn` pro Survival spawn) a inline verze v `packages/shared/src/track/baseRace.test.ts`. Chodí jen po Tracku *v klidu* (`atRest` sundá Motion) — viz bod 2.
- **Pattern pro řízení headless Chrome.** `apps/track-builder/scripts/render-thumbnails.ts` spouští Chrome s `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader` a mluví s ním přes plain WebSocket na DevTools port. Live-verifikace (např. `.scratch/m5-two-round-types/issues/08-live-verification.md`) jezdí stejně: dvě headless Chrome instance, jedna tab na instanci (skrytá tab má suspendovaný `requestAnimationFrame` a herní smyčka se zastaví), reálné key eventy.

---

## 1. Headless herní klienti / load-test boti

**Co přesně testují:** chování Match serveru pod zátěží N souběžných hráčů — drží tick rate 30 Hz (mřížka z `tickScheduler.ts`), drží snapshot rate, jak roste cena ticku a serializace snapshotu s počtem Characters, jak se chová `InputRouter` při jitteru/ztrátách, jestli se server nezasekne při join/leave churnu. Netestují rendering ani feel — jen server a protokol.

**Minimální architektura na našem stacku:**

- Bot = Node proces (ne prohlížeč): `ws` klient + vlastní `RapierSimulation` s `authoritative: false` + `PredictionLoop` z `apps/client/src/net/predictionLoop.ts` (je to čistý TS bez DOM — jde importovat do Node skriptu stejně jako do harnessu).
- Časování: boti nepotřebují vlastní 30Hz smyčku. Stačí posílat `InputMessage` v rytmu snapshotů, které server posílá (reaktivní bot: na každý snapshot odpoví inputem na další Tick), nebo na vlastním `setInterval(33ms)` s LEAD logikou zkopírovanou z klienta. Přesnost wake-upu nevadí — `InputRouter.takeFor` opakuje poslední vstup při hladovění a testuje se právě tohle chování.
- Řízení: jeden orchestrátor skript (`scripts/load-match.ts`), který nastartuje in-process `startServer` (nebo se připojí na běžící API/Lobby), připojí N botů, provede je Lobby (`setReady`, host `start`, `loaded`), a pak sbírá metriky.
- Metriky: tick drift z `serverTimeMs` vs wall clock, snapshot interval, `commandQueueDepth`, cena `JSON.stringify` na serveru, `DONTFALL_PERF` tick log jako ground truth. Výstup ve stejném tvaru jako `bench:sim --json`, aby šly výsledky porovnávat.

**Náklady vs. přínos:** náklady malé — `FaithfulClient` existuje, `scriptedInput` existuje, stačí je spojit a přidat metriky (řádově stovky řádků). Přínos velký: dnes nikdo neví, co server dělá s 12 reálnými klienty přes sockety — `bench:sim` měří sim step in-process bez sítě a M2 byla live-verifikovaná se dvěma prohlížeči. První 12-hráčový Match by neměl být překvapením v produkci.

**Rizika:**
- *Falešná jistota z loopbacku.* Boti na localhostu nevidí reálný jitter/ztráty. Mitigace: vrstva umělé latence jako v `FaithfulClient` (modelovaná one-way latence + jitter), různé profily (`good`/`bad` už v integration testu jsou).
- *Boti hrají „moc hezky".* `scriptedInput` běží rovně vpřed; reální hráči se shlukují na startu a mačkají všechno. Mitigace: startovní shluk + burst vstupy (dash/hit/grab) jako scénář, viz bod 4.
- *Flakiness z wall-clocku.* Timer-driven testy občas cuknou na přetíženém CI. Mitigace: load harness patří do `scripts/`, ne do `pnpm test` — pouští se ručně/před releasem, ne na každý commit.

**První krok:** vytáhnout `FaithfulClient` z `tickAddressedInput.integration.test.ts` do sdíleného modulu (např. `scripts/bots/headlessClient.ts`, importujícího `PredictionLoop` a `TimeSync`-ekvivalent), napsat `scripts/load-match.ts`, který připojí 12 botů na lokální server a 60 s reportuje tick/snapshot statistiky. Hotovo = čísla v ruce, ne framework.

**Proč ne k6/Artillery:** oba umí WebSocket load testing ([k6 vs Artillery srovnání](https://github.com/prajwalhaniya/tech-notebook/blob/HEAD/docs/Testing/04_Load_Testing_with_k6.md)), ale náš protokol je stavový a herní — welcome → seed ticku z `serverTimeMs` + RTT → tick-addressed inputy s redundantním tailem → LEAD feedback z `commandQueueDepth`. V k6 (sandboxovaný JS runtime bez přístupu k `node_modules`) by to znamenalo přepsat kus klienta v cizím dialektu a udržovat druhou implementaci protokolu. Vlastní Node bot importuje `packages/shared` a `PredictionLoop` přímo — protokol má typově a zadarmo, a 12 klientů nepotřebuje distribuovaný load generátor.

---

## 2. Scripted playtest boti

**Co přesně testují:** dokončitelnost Tracku a regresi hratelnosti — každá mezera je přeskočitelná, každá rampa/Spring/fan dosáhne o patro výš, každý Checkpoint se mine, cíl je dosažitelný, spawn grid stojí na podlaze a nic ho během Countdownu nesmete. Netestují, jestli je Track *zábavný* nebo *fér* — timing překážek je vždy play check (říká to sám `walkTrack.ts` v hlavičce).

**Současný stav (prostudováno):**
- `walkTrack.ts`: waypoint walker, steering přímkou na další waypoint, skok čeká na zem (`grounded`), vzdání po `stuckSeconds` bez progresu. Chodí po `atRest(track)` — Motion sundán. `standOn` spawnuje N Characters na startovní grid a nechává je stát bez vstupu se zapnutým Motion — prokazuje, že spawn stojí na podlaze a Countdown je bezpečný.
- `baseRace.test.ts`: stejný walker inline (historicky první), timeout 120 s, waypointy odvozené z layout konstant Tracku. Chůze trvá >120 s sim času.
- Slabiny: (a) rest-pose pravidlo je *autorský slib*, ne vynucení — Track, který ho poruší, projde walkerem a zabije hráče; (b) přímkové steering je záměrně hloupé (cesta, kterou bot nenajde, nenajde ani hráč — správný argument), ale neumí čekat na pohyblivou plošinu; (c) 120s+ sim času na jeden test je pomalé pro CI.

**Minimální architektura rozšíření:**
- *Fáze A (levná):* `walkTrack` s volbou `withMotion: true` — stejný walker, zapnuté Motion. Část Tracků projde, část ne (čekání na plošinu) — i neúspěch je informace: řekne, které sekce *vyžadují* timing, a ty se označí v datech Tracku místo v hlavě autora.
- *Fáze B:* waypoint s `waitUntil` / `waitSeconds` — bot umí stát a čekat (na plošinu, na mezeru mezi sweepy). Stále scripted, stále deterministický, žádná navigace.
- *Fáze C (volitelná):* waypointy generované z dat Tracku (Checkpoint respawny + Finish Zone) jako smoke test „lze projít" pro *každý* publikovaný Track, ne jen code-authored. Dnes walker existuje jen pro čtyři authored Tracks + base race.

**Náklady vs. přínos:** fáze A je změna v řádu desítek řádků s okamžitou hodnotou (které sekce vyžadují timing). Fáze B je malá. Fáze C je střední, ale odemyká validaci Tracků od hráčů při publikaci — což je moment, kdy scripted bot přestává být testem a stává se součástí produktu (publish validace).

**Rizika:**
- *Falešná jistota z rest-pose.* Dnes walker prokazuje geometrii, ne hru. Každý výsledek číst s touto větou v hlavě; nikdy netvrdit „Track je dokončitelný", jen „geometrie Tracku je průchozí v klidu".
- *Křehkost waypointů.* Waypointy čtené z layout konstant se rozbijí při každé editaci Tracku. Mitigace: waypointy jako data vedle Tracku (authored spolu s ním), ne odvozené v testu.
- *Pomalost.* Plná chůze base race >120 s sim času (reálně desítky sekund wall-clocku). Mitigace: do CI jen rychlé varianty (kratší timeout, méně waypointů), plné chůze před releasem / nightly.

**První krok:** přidat `walkTrack` parametr `withMotion` a pustit ho na všech pěti code-authored Tracks; zapsat, které sekce bez čekání neprojdou. To samo o sobě je cenný artefakt (mapa „kde je potřeba timing").

---

## 3. E2E browser boti

**Co přesně testují:** to, co headless klienti neumí — že skutečný klient (React shell, `GameCanvas`, predikce, rendering, zvuk) funguje end-to-end proti skutečnému serveru: přihlášení → Lobby → Ready → start → Countdown → RUNNING → Results, vykreslené HUD, slyšitelné cue. Jsou jediní, kdo vidí *integraci* vrstev.

**Současný stav:** live-verifikace se dnes dělá ad-hoc raw CDP skripty (necommitnuté, přepisované per milestone), dvě headless Chrome instance, reálné key eventy. Našlo to pokaždé reálné bugy, které Vitest neviděl (tři v M5: ghost Characters, zamrznutí po Track picku, duplicitní DNF řádek — `.scratch/m5-two-round-types/issues/08-live-verification.md`). Cena: pokaždé psát znovu, nic se neregre-testuje.

**Minimální architektura na našem stacku:**
- **Playwright, ne raw CDP, ne Puppeteer.** Důvody: (a) `BrowserContext` — více izolovaných hráčů v jednom browser procesu ([docs](https://github.com/microsoft/playwright/blob/HEAD/docs/src/browser-contexts.md)), což řeší dnešní „jedna tab = jedna instance" režii; (b) auto-waiting a trace viewer pro flaky E2E; (c) headless WebGL přes SwiftShader funguje s těmi samými flagy, které repo už používá (`--use-angle=swiftshader --enable-unsafe-swiftshader` — Chrome od verze 130 vyžaduje explicitní flag, jinak WebGL kontext mlčky nevznikne a testy jsou „green-on-nothing" ([kontext](https://github.com/sceneview/sceneview/issues/1674))); repo pattern viz `render-thumbnails.ts`. Pozor: hidden tab suspenduje `requestAnimationFrame` — každý bot potřebuje vlastní viditelnou stránku (dnešní praxe „jedna tab na instanci" to řeší hrubou silou; v Playwrightu stačí dva `BrowserContext` s vlastními `Page`, každá ve vlastním okně procesu, ne dvě taby).
- Co ovládat: reálné `keyboard.down/up` pro pohyb (jako dnes), klikání na skutečné Lobby/Results UI, čtení stavu z DOM (HUD text, phase) + z herního API vystaveného pro testy (`window.__game` handle — malý test hook, ne debug backdoor do produkční logiky).
- Rozsah: 3–5 scénářů, ne víc — „dva hráči dojdou z Lobby do Results", „host pickne Track a oba hrají nový", „disconnect mid-Round". Každý další scénář je údržba.
- Kde běžet: lokálně + nightly, **ne** na každý commit. Potřebují Chrome, GPU/SwiftShader, ~minuty času. Na CI jen pokud bude vyhrazený runner.

**Náklady vs. přínos:** náklady střední až vysoké (nová dev-dependency, infra, psaní a ladění flaky testů). Přínos: regresní síť na integrační bugy, které dnes chytá jen ruční live-verifikace. Ale live-verifikace tím nemizí — E2E boti chytají *regrese známých cest*, člověk s gamepadem chytá *nové* bugy. Jsou doplněk, ne náhrada.

**Rizika:**
- *Flakiness.* Timing prohlížeče + sítě + 30Hz serveru = občasné pády bez příčiny. Mitigace: velkorysé timeouty, retry na úrovni scénáře, assertions na stav (phase, `finishTick`), nikdy na přesný čas.
- *Údržba.* Každá změna UI rozbije selektory. Mitigace: `data-testid` atributy na hrstce klíčových elementů (Lobby ready/start, Results rows), testovat přes ně.
- *Green-on-nothing.* WebGL se neinicializuje a test „projde", protože nic nepadlo. Mitigace: každý scénář musí assertnout pozitivní důkaz života (phase RUNNING + pozice Characteru se mění + screenshot není černý).
- *SwiftShader ≠ GPU.* Software rendering je pomalý a vizuálně mírně jiný. E2E boti nejsou vizuální testy — na vzhled zůstává člověk a screenshoty z `render-thumbnails.ts`.

**První krok (až přijde čas):** jeden Playwright test — dva `BrowserContext` proti lokálnímu stacku (`pnpm dev`), projdou Lobby → start → oba vidí RUNNING → jeden dojde do Finish Zone (scripted key sekvence, Track base race v klidu nestačí — vzít krátký testovací Track nebo freeroam). Teprve když je tenhle stabilní přes 20 běhů, přidat další.

---

## 4. AI / random-input boti, chaos a soak testy, fuzzing sim stepu

**Co přesně testují:** robustnost, ne správnost — že sim step nikdy nepadne, nikdy nevyprodukuje NaN/nekonečno, nikdy nezasekne server, ať přijde jakýkoli vstup; že dlouhý běh (soak) nedegraduje (memory leak, rostoucí tick); že desynchronizace klient/server se vždy srovná.

**Čtyři pod-úrovně, od nejlevnější:**

1. **Fuzz sim stepu (nejlevnější, nejvyšší hodnota).** Volat `sim.tick(randomInputs)` ve Vitestu se seedovaným PRNG (např. `mulberry32` — pár řádků, žádná dependency) a po každém ticku assertovat invarianty: žádné NaN v pozicích/velocitách, `motionState` je vždy validní, `characters` nikdy nemizí/přibývají mimo `add/removeCharacter`, tick counter roste. Tisíce ticků za sekundy, plně deterministické (seed v logu → reprodukce zdarma). Tohle dnes neexistuje a mělo by — je to nejlevnější test v celém dokumentu.
2. **Soubojové chaos scénáře.** N botů na Survival aréně mačká dash/hit/grab náhodně (seedovaně) — cíl: shodit se navzájem, vyvolat Ragdoll/Held/Limp/Spin/Hurl kombinace, které scripted testy nepokryjí. Běží in-process nad `RapierSimulation` (jako `standOn`), nebo přes sockety nad serverem (jako bod 1 s chaos input generátorem). Hledá paniky a zaseknuté stavy, ne balance.
3. **Soak test.** Bod 1 puštěný na hodiny: 12 botů, opakované Rounds, join/leave churn, sledovat RSS procesu, tick p99 drift, růst snapshot velikosti. Jednorázová akce před releasem, ne CI.
4. **„Chytrá" AI: nedělat.** Navigace po Tracku (pathfinding, timing skoků přes pohyblivé překážky) je projekt sám o sobě, křehký při každé změně Tracku, a jeho výpověď („bot došel do cíle") je stejná jako u scripted chůze z bodu 2 za zlomek ceny. Jediná výjimka, kdy AI dává smysl: boti jako *herní obsah* (protivníci pro sólového hráče) — to je ale produktová feature, ne testování, a patří do vlastního milestone.

**Determinismus — důležitá poznámka k ADR 0003.** ADR 0003 říká, že „Rapier není spolehlivě deterministický napříč platformami", a proto je lockstep vyloučen. Oficiální dokumentace Rapieru dnes tvrdí opak: WASM/JS verze je [plně cross-platform deterministická](https://rapier.rs/docs/user_guides/javascript/determinism/) při stejné verzi, stejných počátečních podmínkách a stejném pořadí přidávání/odebírání těl. Repo tu podmínku pořadí už ctí (`RapierSimulation.ts`: eliminační „marked, never removed" drží iteraci stabilní; `tickAddressedInput.integration.test.ts` zmiňuje ověřenou shodu dvou instancí se stejnou sekvencí vstupů). Co z toho plyne pro boty:
- Fuzz/soak se seedem je reprodukovatelný na jednom stroji se stejnou verzí Rapieru — to stačí.
- Lockstep multiplayer to automaticky neobhajuje (ADR 0003 má i další důvody — snapshot netcode je hotový a funguje), ale tvrzení o nedeterminismu by si zasloužilo přeměření; pokud by se potvrdil determinismus, otevírá to replay-based testy (nahrát inputy z live-verifikace, přehrát v CI).
- Pozor: determinismus platí pro stejnou verzi Rapieru — upgrade `@dimforge/rapier3d-compat` může změnit výsledky a zneplatnit nahrané replaye.

**Rizika:**
- *Nereprodukovatelnost.* Jakýkoli `Math.random()` v botovi = bug, který nejde zopakovat. Vždy seedovaný PRNG, seed do logu. Stejná disciplína jako `slipRoll`.
- *Invarianty místo oracle.* Fuzz neví, co je „správně" — ví jen, co je „rozbité" (NaN, pad, zaseknutí). Slabší než assertion, ale nachází jinou třídu bugů.
- *Falešné poplachy ze soak.* RSS roste i z fragmentace; tick drift i z Cronu na pozadí. Soak potřebuje klidový stroj a baseline.

**První krok:** `RapierSimulation.fuzz.test.ts` — 10k ticků se seedovaným PRNG přes base race (v klidu i s Motion), invarianty po každém ticku, seedy fixní v kódu + jeden z `process.env` pro nightly variace. Pár desítek řádků.

---

## Doporučené pořadí (shrnutí)

1. **Teď (malé, cenné):** fuzz sim stepu (4.1) + `withMotion` chůze (2, fáze A). Obojí dny, ne týdny. Obojí najde bugy, ne frameworky.
2. **Pak (střední, cenné):** headless load harness (1) — `FaithfulClient` ven z testu, 12 botů, metriky ve tvaru `bench:sim --json`. První reálná čísla o serveru pod plným lobby.
3. **Průběžně:** chaos input generátor sdílený mezi 1 a 4.2; soak před releasem.
4. **Později (drahé, úzké):** Playwright E2E na 3–5 kritických cest (3). Až bude load harness rutina a E2E mezera bolet — ne dřív.
5. **Nikdy (jako testování):** chytrá hrající AI, k6/Artillery, lockstep replaye (dokud je ADR 0003 platná).

## Zdroje

**Repo:**
- `packages/shared/src/simulation/RapierSimulation.ts`, `SimInputs.ts`, `slipRoll.ts` — sim step, vstupy, deterministický tah
- `packages/shared/src/net/protocol.ts`, `apps/server/src/net/inputRouter.ts`, `apps/server/src/match/tickScheduler.ts` — protokol, tick-addressed input, 30Hz mřížka
- `scripts/bench-simulation.ts`, `scripts/benchInputs.ts` — existující měření a `scriptedInput`
- `apps/server/src/match/tickPerf.ts` — `DONTFALL_PERF=1` tick log
- `apps/client/src/net/predictionLoop.ts`, `predictionRegression.harness.test.ts` — produkční predikce řiditelná headless
- `apps/server/src/net/tickAddressedInput.integration.test.ts` — `FaithfulClient`, šablona bota
- `packages/shared/src/track/walkTrack.ts`, `packages/shared/src/track/baseRace.test.ts` — scripted chůze
- `apps/track-builder/scripts/render-thumbnails.ts` — pattern headless Chrome + SwiftShader + plain WebSocket CDP
- `.scratch/m5-two-round-types/issues/08-live-verification.md` — jak dnes vypadá live-verifikace a co našla
- `docs/adr/0003-snapshot-netcode-no-rollback.md`, `0013-…`, `0021-…`, `0027-…`, `0109-…` — rozhodnutí, která boti musí ctít

**Externí (primární):**
- [Rapier — Determinism](https://rapier.rs/docs/user_guides/javascript/determinism/) — WASM/JS build je cross-platform deterministický při stejné verzi a stejných počátečních podmínkách
- [Playwright — Browser contexts](https://github.com/microsoft/playwright/blob/HEAD/docs/src/browser-contexts.md) — více izolovaných hráčů v jednom browser procesu
- [Chrome 130+ vyžaduje `--enable-unsafe-swiftshader` pro headless WebGL](https://github.com/sceneview/sceneview/issues/1674) — bez něj testy projdou nad mrtvým kontextem
- [k6 vs Artillery pro WebSocket zátěž](https://github.com/prajwalhaniya/tech-notebook/blob/HEAD/docs/Testing/04_Load_Testing_with_k6.md) — proč ani jeden: stavový herní protokol se lépe píše ve vlastním Node klientovi s `packages/shared`
