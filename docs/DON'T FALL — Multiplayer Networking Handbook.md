# Multiplayer Networking Handbook pro DON'T FALL
Tato učebnice syntetizuje devět zdrojů, které jsi poslal (Valve Source Networking wiki), akademickou práci Yahna Bernaira o lag compensation, sérii Glenna Fiedlera o networked physics, GDC breakdown Overwatch netcode a real-world implementace (Unity Ultimate Glove Ball, Photon Fusion, Normcore) do jedné rozhodovací příručky pro server-authoritative multiplayer hru s Rapier physics, TypeScriptem a WebSocketem. Cílem je, aby ses po přečtení uměl rozhodnout, jak síťovat každou konkrétní entitu v DON'T FALL — Character, Prop, Spinner, Ragdoll, Track — a proč.
## 1. Základní architektura: autoritativní server
Všechny relevantní hry (Source engine, Half-Life, Overwatch) používají stejný fundamentální model: jeden autoritativní server běžící herní logiku a fyziku v discrete časových krocích (ticích), ke kterému se připojují "hloupí" klienti. Klient vzorkuje input, pošle ho na server, server ho zpracuje a vrátí novou pravdu o světě. Server nikdy nevěří klientskému tvrzení o vlastní pozici — to je jediná obrana proti man-in-the-middle cheat proxies a upraveným klientům.[^1][^2]

Source engine simuluje svět v discrete tickách (výchozí 15 ms, tedy 66,67 ticků/s, ale liší se hra od hry — 30 v L4D, 64 v CS2). DON'T FALL běží na serverovém 30 Hz ticku, což je přesně tickrate, jaký Valve používá u Left 4 Dead a Team Fortress Classic — dostatečné pro physics-based party hru bez potřeby hitscan přesnosti FPS.[^3]

Server po každém ticku rozhoduje, zda klientovi pošle update, a vytváří snapshot — nikoliv nutně po každém simulačním ticku. To je zásadní odlišení tří pojmů, které se v codebase často pletou:[^3]

| Pojem | Co znamená | V DON'T FALL |
|---|---|---|
| Simulation tick | Frekvence, kterou server pokročí fyziku | 30 Hz, fixní |
| Snapshot/update rate | Frekvence, kterou server posílá stav klientům | Může být ≤ tickrate |
| Command rate | Frekvence, kterou klient posílá input | Nezávislé, obvykle stejné jako tick |

Zásadní designové rozhodnutí je, zda hru stavět jako **deterministic lockstep**, **snapshot interpolation**, nebo **state synchronization** — to jsou tři fundamentálně odlišné strategie networked physics podle Glenna Fiedlera, a každá se hodí jinam.[^4]
## 2. Tři strategie networked physics a proč DON'T FALL nepotřebuje lockstep
### Deterministic lockstep
Lockstep sesílá jen input, nikdy stav — bandwidth je proporcionální velikosti inputu, ne počtu objektů ve světě. Problém: vyžaduje bit-přesný deterministický fyzikální simulátor na obou stranách, což je s plovoucí desetinnou čárkou napříč compilery, OS a instrukčními sadami extrémně obtížné. Navíc s rostoucím počtem hráčů roste latence, protože simulace čeká na input od *všech* hráčů — nejpomalejší hráč diktuje tempo všem ostatním.[^5][^6]

Fiedler explicitně doporučuje lockstep jen pro 2-4 hráče. DON'T FALL má 4-12 hráčů a používá Rapier — plnohodnotný nedeterministický fyzikální solver — takže lockstep je z obou důvodů vyloučen.[^7]
### Snapshot interpolation
Server posílá plný snapshot vizuálního stavu (position, orientation) a klient žádnou simulaci nespouští — jen interpoluje mezi dvěma přijatými snapshoty. Toto je přesně model, který Source engine používá pro remote entity (viz sekce 4). Nevýhoda je bandwidth — Fiedler u 900 kostek naměřil 25 KB na snapshot, tedy 11,6 Mbit/s při 60 pakety/s. Řešením je snížit send rate a použít lepší interpolaci (hermitovské křivky) nebo prioritizaci objektů.[^7]
### State synchronization
Hybrid: server i klient simulují stejnou fyziku, ale server posílá jak input, tak i stav (position, orientation, linear/angular velocity). Díky tomu se nemusí posílat update pro každý objekt v každém packetu — klient si mezitím sám extrapoluje pomocí lokální fyziky, takže lze poslat jen pár nejdůležitějších objektů podle priority accumulatoru. Toto je model, který Unity Ultimate Glove Ball reálně implementoval pro síťování fyzikálních míčků, přímo inspirovaný Fiedlerovým blogem.[^8][^9]

**Pro DON'T FALL je doporučená kombinace:** state synchronization pro Character (server-authoritative capsule + client prediction, sekce 3) a lightweight snapshot interpolation pro Props a ostatní entity (sekce 5), protože nepotřebuješ bit-perfect determinismus a tvůj hráčský počet (4-12) dělá plný per-object state sync zvládnutelný na 30 Hz.
## 3. Client-side prediction a server reconciliation
### Proč predikce existuje
Bez predikce platí: hráč se 150ms latencí zmáčkne tlačítko, server ho zpracuje, výsledek se propaguje zpět — hráč vidí vlastní pohyb až po 150 ms. To vytváří nepřirozený pocit a ztěžuje přesné ovládání. Client-side prediction tento problém řeší tak, že klient simuluje výsledky vlastních příkazů okamžitě, aniž by čekal na server, běžíc *přesně stejný kód a pravidla*, jaké používá server.[^3][^1]
### Algoritmus (Half-Life / Source model)
Klient uchovává historii odeslaných příkazů. Server potvrzuje poslední zpracovaný input (`lastInputTick`). Klient vezme poslední potvrzený stav ze serveru jako výchozí bod a znovu simuluje všechny nepotvrzené příkazy:[^1]

```
"from state" <- state after last acknowledged command
"command" <- first command after last acknowledged
while (true):
    run "command" on "from state" -> "to state"
    if last command: break
    "from state" = "to state"; "command" = next command
```

Toto přesně odpovídá tomu, co má DON'T FALL implementovat v `RapierSimulation` — `SimState.lastInputTick` je přímo tento acknowledgement mechanismus, a `bumpSeq` v `CharacterSnapshot` slouží jako "force-apply" signál pro věci, které klient nemohl predikovat (Bump od jiného hráče, Fall na hraně).[^2]
### Reconciliation a chyby predikce
Pokud server vrátí jinou pozici, než klient predikoval, nastala prediction error — klient musí korigovat svou pozici. Source rozlišuje hard snap a smooth correction (`cl_smooth`), protože náhlé teleportace jsou vizuálně rušivé. Fiedler doporučuje u state sync neaplikovat smoothing na úrovni simulace (musí extrapolovat z validního fyzikálního stavu), ale místo toho počítat position/orientation error offset, který se postupně (exponenciálně) redukuje k nule při renderování. Používá dva různé koeficienty vyhlazování — pomalejší (0.95) pro malé chyby, rychlejší (0.85) pro velké pop korekce, protože protahování velké korekce je pro hráče dezorientující.[^3][^1][^8]
### Side effects a IsFirstTimePredicted
Kritická jáma: pokud klient replayuje staré příkazy, nesmí znovu spustit zvukové efekty, VFX nebo jiné jednorázové vedlejší účinky. Source řeší toto pomocí `prediction->IsFirstTimePredicted()` — kód se provede jen při prvním předikování akce, ne při kontrole proti následným server updatům. Toto přesně odpovídá poznámce v `SimState.ts`, že `teleported` flag musí renderer respektovat jen jednou a `bumpSeq`/`ragdollEpoch` musí být monotónní counter, ne boolean, aby nedocházelo k opětovnému spuštění efektu na stejném stale snapshotu.[^10][^11]
### Co lze predikovat a co ne
Predikce je možná jen pro entity manipulovatelné lokálním hráčem — predikovat pohyb jiných hráčů by znamenalo predikovat budoucnost bez dat o jejich vstupu. Server proto v DON'T FALL simuluje autoritativně všechny Character instance, ale klient predikuje pouze svou vlastní; ostatní Character se pouze interpolují (sekce 4).[^10]
## 4. Interpolace vzdálených entit
### Proč interpolace, ne přímé vykreslování
Server posílá jen ~20-30 snapshotů za sekundu. Pokud by se entity vykreslovaly přesně na přijatých pozicích, pohyb by byl trhaný a ztráta paketu by byla vizuálně nápadná. Trik je vykreslovat entity s časovým posunem do minulosti — Source defaultně 100 ms (`cl_interp 0.1`) — takže se vždy interpoluje mezi dvěma naposledy přijatými snapshoty.[^3][^5]
### Position history buffer, ne jen "poslední dva"
Bernier zdůrazňuje, že jednoduchý model "vždy interpoluj k poslednímu přijatému stavu" má vážné problémy s kvalitou — tzv. "flattening" efekt u odrážejících se objektů, protože interpolační cíl skoro nikdy neodpovídá extrémům (vrchol odrazu, dotek země). Řešení: udržovat kompletní historii pozic s timestampy a hledat dvojici, která obepíná cílový render time, ne jen poslední dva přijaté snapshoty. Toto je stejný princip jako `cl_interp_ratio` v Source, kde se hledá pár snapshotů obklopujících render time = current time − interpolation delay.[^3][^1]

Vzorec pro interpolační zpoždění v Source:

\[
\text{interpolation period} = \max\left(\text{cl\_interp}, \frac{\text{cl\_interp\_ratio}}{\text{cl\_updaterate}}\right)
\]

kde výsledek je navíc omezen na maximum 0.25 s. Pro DON'T FALL při 30 Hz snapshotech doporučená hodnota interpolačního delay je zhruba 2× period mezi snapshoty (tedy ~66 ms), s bufferem na alespoň dva vzorky pro odolnost proti jedné ztracené packetě.[^12][^3]
### Extrapolace jako fallback, ne jako strategie
Pokud chybí i druhý snapshot, Source přechází na krátkou lineární extrapolaci (`cl_extrapolate`), ale jen do 0.25 s, protože chyba extrapolace rychle roste. Fiedler ukazuje, že extrapolace u rigid body physics je nespolehlivá — cube "extrapoluje skrz zem" a musí se pak vizuálně "napravovat", protože extrapolace nezná kolize ani fyzikální omezení. Pro DON'T FALL: extrapolace se používá jen jako nouzové řešení pro krátký výpadek (≤ 250 ms), nikdy jako trvalá strategie pro Props nebo Ragdolly.[^3][^7]
### Teleport handling
Když entita "teleportuje" (respawn na checkpointu), interpolace mezi starou a novou pozicí by vytvořila falešné "letění" přes mapu. Bernier i Source řeší toto explicitním "don't interpolate" flagem nebo vyčištěním historie pozic, případně detekcí příliš velké vzdálenosti mezi snapshoty jako presumpci teleportu. Toto přesně odpovídá `teleported: boolean` v `CharacterSnapshot`, kde renderer musí na tomto ticku snap, ne interpolovat.[^3][^1][^11]
## 5. Dynamic Props: server simuluje, klient sleduje
### Proč Props nejsou jako Character
Character má lokálního vlastníka (hráče), takže predikce dává smysl. Prop, který "leží ve světě" a s ním interaguje kdokoliv, nemá jasného vlastníka — a pokud by ho každý klient simuloval nezávisle celou dobu, výsledky by se rychle rozešly kvůli nedeterminismu Rapier solveru.

Reálná implementace v produkční VR hře (Unity Ultimate Glove Ball) řeší přesně tento problém state synchronizací podle Fiedlerova vzoru: server posílá `Sequence`, `Position`, `Orientation`, `LinearVelocity`, `AngularVelocity` a boolean `IsGrabbed`; klient lokálně spouští fyziku a "dohání" (catch-up) podle příchozích dat. Packet navíc obsahuje jitter buffer, aby se zabránilo aplikaci paketů v nesprávném pořadí, a gradual position/rotation/velocity korekci, aby se zamezilo "popům".[^9]
### Ownership model pro Props
Standardní vzor v komerčních multiplayer frameworcích (Photon Fusion, Normcore, Spatial) je ownership: jen jeden klient (nebo server) má právo zapisovat autoritativní stav objektu v daném okamžiku. Fusion nabízí čtyři módy:[^13][^14][^15][^16]

| Mode | Chování | Použití |
|---|---|---|
| PlayerAttached | Trvale vlastněno tvůrcem, nelze přenést | Avatary, vybavení |
| Transaction | Explicitní request/release, jeden vlastník s cooldownem | Sdílené zdroje, interaktivní Props |
| Dynamic | Kdokoliv okamžitě převezme, s cooldownem proti oscilaci | Fyzikální objekty, míčky |
| MasterClient | Vždy master klient | Herní stav, scoreboard |

Pro DON'T FALL, kde je server jediná autorita (ne peer-to-peer), tento model zjednodušíš: **server je vždy jediný autoritativní simulátor Prop fyziky**. Klient pouze *dočasně* lokálně predikuje Prop, se kterým lokální hráč právě interaguje (pro pocit responzivity), ale musí se řídit stejnými pravidly jako Character prediction — s hard-correction při rozchodu nad `PROP_HARD_CORRECT_DISTANCE`. To je přesně to, co `RapierSimulation.syncPropsToSnapshot` v tvém kódu dělá: `locallyLiveProps` sada je klientská optimalizace, ne autorita — server nikdy nepočítá s tím, že klient rozhoduje.[^12]

Spatial's Network Physics toolkit řeší kontaktní kolize dvou nezávisle vlastněných rigidbody tím, že přenese vlastnictví na klienta s vyšší rychlostí objektu v okamžiku kolize — to je vzor relevantní jen pro peer-authoritative topologie; v server-authoritative DON'T FALL tuto komplexnost nepotřebuješ, protože server rozhoduje o všech kolizích rovnou.[^13]
### Kategorizace objektů podle chování
| Kategorie | Příklad v DON'T FALL | Autorita | Klientská predikce | Síťovaná data |
|---|---|---|---|---|
| Static deterministic | Track geometrie, zdi | Žádná (config při joinu) | N/A | Seed/config jednou |
| Kinematic pure-function | Spinner | Server (tick → úhel) | Lokální dopočet ze stejné funkce | Config + tick |
| Dynamic passive | Prop v klidu | Server | Ne | Position, rotation, at-rest flag |
| Dynamic touched | Prop tlačený hráčem | Server | Krátce lokálně (grace period) | Plný state update + korekce |
| Ragdoll | Character po Fallu | Server | Ne (jen animace přechodu) | Epoch, bones, cause |
| Trigger/zóna | Checkpoint, Finish | Server-only rozhodnutí | Lokální anticipační VFX | Domain event |
### At-rest optimalizace
Fiedler ukazuje důležitou bandwidth optimalizaci: nesmyslné je posílat `(0,0,0)` velocity opakovaně pro objekt v klidu — místo toho se posílá jeden `at_rest` bit, a pokud je `true`, velocity se vůbec nepřenáší. Navíc doporučuje krátce zvýšit prioritu objektu, který právě usnul (přešel do klidu), dokud nepřijde potvrzení (ack) o doručení jeho poslední pozice — jinak může "šedá kostka" zůstat trvale na špatné pozici při ztrátě paketu. Pro DON'T FALL to znamená: `PropSnapshot` by měl nést at-rest flag a Props v klidu by měly krátce po ustálení dostat vyšší prioritu odesílání, ne nižší.[^8]
## 6. Ragdoll: epoch, ne boolean
Ragdoll je speciální případ Prop-like entity, kde chyba stavového automatu je obzvlášť viditelná. Z tvého kódu (`SimState.ts`) vyplývá správný model: `motionState` (Controlled/Ragdoll/GettingUp) plus `bones: BoneSnapshot[]` plus separátní `bumpSeq` counter, který slouží jako "tento konkrétní pád je nová událost, ne pokračování staré". Toto respektuje doporučení Bernaira, že non-visual state (jako "byl hráč mrtvý nebo živý") musí být vzat do úvahy při rewind operacích, protože jinak dojde k inkonzistenci — analogicky, epoch-based identita zabraňuje tomu, aby stale/duplicate snapshot znovu spustil collapse animaci.[^1][^11]

Klíčové pravidlo: **jedna epoch = jedno spuštění vizuálního efektu**. `activateFromStanding()` nesmí být zaměněno za `applyAuthoritativePose()` — první je jednorázová akce spuštěná změnou epoch, druhá je pokračující synchronizace pozice bones každý tick.
## 7. Lag compensation: kdy ano, kdy ne
### Co lag compensation řeší
Lag compensation je technika, kdy server *dočasně* vrátí ostatní hráče zpět v čase na pozici, kde byli v okamžiku, kdy útočník viděl a stiskl tlačítko. Vzorec pro dobu, o kterou se vrací:[^17][^1]

\[
\text{Command Execution Time} = \text{Current Server Time} - \text{Packet Latency} - \text{Client View Interpolation}
\]

Server pak posune *jen ostatní hráče* (nikoliv statické prostředí) zpět na jejich historickou pozici, vyhodnotí zásah, a poté je vrátí na aktuální pozici. Historie se typicky uchovává jednu sekundu.[^1][^17]
### Paradox "zásah za rohem"
Toto vytváří známý paradox: hráč s vysokou latencí může "zasáhnout" jiného hráče, který se z jeho pohledu skryl za rohem — protože útočníkův klient viděl cíl ještě na otevřeném prostranství, a server tuto historickou realitu použil při vyhodnocení. Bernier explicitně říká, že to je vědomý herní design trade-off, ne bug — Valve se rozhodl pro responzivní střelbu na úkor tohoto vzácného paradoxu.[^17][^1]
### Proč to DON'T FALL v M2 nepotřebuje
Lag compensation dává smysl pro instant-hit weapons a přesný hit-detection (hitscan zbraně, přesné grab targety). DON'T FALL v M2 nemá takové mechaniky — Bump, Fall a kolize s Props jsou fyzikální kontaktní interakce vyhodnocované přímo Rapier solverem na serveru, ne ray-casty vyžadující "co hráč viděl". Lag compensation navíc nikdy nepokrývá projektily žijící autonomně na serveru — ani Half-Life je nekompenzoval, protože otázka "o kolik vrátit ostatní hráče zpět pro projektil, který sám cestuje v čase" nemá čisté řešení. Pro pozdější mechaniky typu Punch/Grab lze zvážit *cílenou* rewind jen capsule cíle na krátké okno (150-250 ms), ale nikdy rewind celého Rapier world.[^18][^17]
### NPC lag compensation jako analogie
Valve's NPC Lag Compensation tutorial ukazuje, že stejný princip lze rozšířit i na entity, které nejsou hráči (`LagRecordNPC`, historie pozic a animačních vrstev). To je koncepčně blízké tomu, jak by DON'T FALL mohl v budoucnu rewindovat i Props pro přesné grab interakce, ale komplexnost tohoto kódu (stovky řádků jen pro synchronizaci animačních layer dat) je důvod, proč se to nedoporučuje implementovat plošně bez konkrétní herní potřeby.[^10]
## 8. Randomness a determinismus
### Gameplay RNG vždy na serveru
Multiplayer hry s náhodnými herními výsledky (loot, item box, procedural generation) čelí základnímu problému: pokud každý klient generuje "náhodné" výsledky nezávisle, výsledky se rozejdou. Řešení používané napříč herními projekty — od RimWorld Multiplayer po Factorio — je identický seed a deterministický PRNG na všech stranách.[^19][^20][^21][^22]

Zásadní pravidlo z Civilization IV modding guide: stav RNG *je součástí gamestate* — jeho použití měnící herní stav musí běžet jen v synchronizovaném kódu na všech instancích ve stejném pořadí. Existuje rozdíl mezi "sync" RNG (ovlivňuje herní stav, musí být identické) a "async" RNG (jen UI/kosmetika, může být lokální).[^23]

Pro DON'T FALL to znamená jasné rozdělení:

```ts
type MatchSeed = number;      // sync — server generuje, nikdy klient
type RoundSeed = number;      // sync — pro Track generation
type CosmeticSeed = number;   // async — lokální, jen VFX/particles
```

**Item Box výsledek, Track generation výsledek a jakýkoliv gameplay-relevantní random musí být rozhodnut serverem a poslán klientovi jako hotový výsledek nebo jako seed + verzovaný katalog modulů** — nikdy jako "klient si to sám vygeneruje". Toto je stejný princip, jaký popisuje procedural generation guide: sdílený seed umožňuje generovat identický svět bez přenosu celé geometrie, ale jen pokud algoritmus i verze dat jsou identické na obou stranách.[^21]
### Source's IsFirstTimePredicted seed trick
Source engine používá pro predikované náhodné efekty seed odvozený z čísla user command — díky tomu je výsledek identický na klientu i serveru, protože obě strany počítají se stejným vstupním číslem. Tento vzor (seed = deterministická funkce něčeho, co obě strany znají — tick number, entity ID, event sequence) je bezpečný způsob, jak povolit *kosmetickou* klientskou predikci náhodných efektů bez rizika desynchronizace vzhledu.[^10]
### Overwatch: predikuj i projektily, ale věř serveru
GDC talk o Overwatch netcode ukazuje neobvyklý, ale úspěšný přístup: predikuje se *vše* — pohyb, schopnosti i projektily — a explicitně se opt-outuje jen tam, kde je to nutné. Klíčový mechanismus pro zvládání ztráty paketů je "time dilation": když server detekuje input starvation, signalizuje klientovi, aby simuloval nepatrně rychleji (např. 15.2 ms místo 16 ms tiku) a nahromadil buffer inputů dřív, než ztráta paketu způsobí problém. To je sofistikovanější verze playout delay bufferu, který Fiedler popisuje u deterministic lockstep.[^6][^7]
## 9. UDP vs. WebSocket: proč DON'T FALL nemá na výběr
### Fundamentální rozdíl
UDP je connectionless, "fire-and-forget" — pakety mohou být ztraceny, duplikovány nebo doručeny v jiném pořadí, ale bez čekání na potvrzení. TCP (a tedy i WebSocket, který běží nad TCP) garantuje spolehlivé, řazené doručení, ale za cenu retransmission latence při ztrátě paketu.[^24][^25]

Klíčový technický důvod, proč hry preferují UDP: TCP header je zhruba 4× větší než UDP's fixní 8bajtový header, a při desítkách paketů za snímek při 30 Hz to znamená 10-100 KiB/s navíc jen na overhead. Horší je ale head-of-line blocking — pokud je jeden TCP packet ztracen, *všechny* následující pakety musí čekat na jeho retransmisi, než mohou být doručeny aplikaci, i když samy dorazily v pořádku.[^26][^25]
### Reálná měření
Nezávislé testy (Unity NGO) ukazují 2.3× vyšší latenci u WebSocketu oproti UDP se stejným zatížením. Jiný benchmark ukazuje při 30 FPS packet rate: UDP s 0.63% loss rate a 24.21 ms latencí, vs. WebSocket s 0% loss ale 30 ms latencí. WebRTC data channels (SCTP unordered/unreliable mode) dosahují RTT kolem 40-50 ms vs. WebSocket kolem 80-90 ms na stejné síti bez ztráty paketů.[^27][^28][^29]

| Protokol | Reliability | Ordering | Typická RTT overhead | Head-of-line blocking | Dostupný v browseru |
|---|---|---|---|---|---|
| Raw UDP | Ne | Ne | Nejnižší | Ne | Ne (bez WebRTC) |
| WebRTC DataChannel (unreliable) | Volitelná | Volitelná | Nízký (~40-50 ms) | Ne | Ano |
| WebSocket (TCP) | Ano | Ano | Vyšší (~80-90 ms), zhoršuje se s loss | Ano | Ano nativně |
| Raw TCP | Ano | Ano | Podobný WebSocketu minus HTTP upgrade | Ano | Ne |
### Proč to nemění rozhodnutí pro DON'T FALL
Browser prostředí nemá přímý přístup k raw UDP soketům z bezpečnostních důvodů. Jediné dvě reálné cesty pro webovou hru jsou WebSocket (TCP) nebo WebRTC DataChannel v unreliable/unordered módu (efektivně UDP-like). WebRTC vyžaduje mnohem komplexnější signaling (STUN/ICE handshake, offer/answer) a zatím nemá tak universální server-side tooling jako WebSocket.[^26][^29]

Pro DON'T FALL v M2 s 4-12 hráči, 30 Hz tickrate a fyzikou, kde drobná ztráta paketu je maskována interpolací (sekce 4) a reconciliací (sekce 3), je WebSocket akceptovatelný — přesně tak, jak doporučuje analýza gamedev fóra: "WebSocket average latencies jsou v podstatě ekvivalentní raw TCP/UDP, zejména v lokální síti, takže to je v pořádku i pro produkční fázi". Nevýhoda head-of-line blocking se dá zmírnit tím, že server pravidelně posílá plné, ne delta, snapshoty (takže i po zpoždění klient rychle "dožene" aktuální stav), a tím, že se v jednom WebSocket message batchuje víc dat najednou (méně malých zpráv = méně příležitostí pro HOL blocking).[^30]

**Kdy by měl DON'T FALL migrovat na WebRTC DataChannel:** pokud budoucí verze zavede rychlé kompetitivní mechaniky citlivé na 30-50 ms rozdíl (hitscan, přesné PvP souboje) a měření ukáže, že WebSocket HOL blocking při reálné ztrátě paketů (mobile, wifi) vytváří vnímatelné hitche. Do té doby je náklad na implementaci WebRTC signaling servery neúměrný přínosu.
## 10. TypeScript vs. rychlejší jazyk: kdy to řešit
### Kde je skutečný bottleneck
Síťová latence (30-150 ms RTT) je o 2-3 řády větší než rozdíl mezi TypeScript/Node.js a nativním jazykem (C++/Rust/Go) při zpracování jednoho simulačního ticku pro 4-12 hráčů. Node.js s V8 JIT compilerem zvládá desetitisíce jednoduchých operací za milisekundu; s Rapier (WASM-compiled Rust physics engine) je fyzikální krok už nativní kód bez ohledu na to, že ho voláš z TypeScriptu — `RapierSimulation.ts` z tvého kódu importuje `@dimforge/rapier3d-compat`, což znamená, že samotný fyzikální solver *už běží jako WASM*, nikoliv jako interpretovaný TS.[^1]

Reálný náklad TypeScriptu/Node je jinde:
- Serializace/deserializace JSON přes WebSocket (`protocol.ts` ukazuje, že M2 posílá čistý JSON, ne binární formát).[^6]
- Single-threaded event loop — Node.js zpracovává všechny WebSocket zprávy a herní tick v jednom vlákně; při 4-12 hráčích a 30 Hz to je zvládnutelné, ale při stovkách souběžných matchů na jednom procesu by to mohl být limit.
- Garbage collection pauzy — nepredikovatelné, ale u malého tick rate (30 Hz = 33 ms rozpočet na tick) obvykle neproblematické pro tuto velikost hry.
### Kdy dává smysl přejít na jiný jazyk
| Situace | Doporučení |
|---|---|
| 4-12 hráčů, jeden match server proces | Zůstat u TypeScript/Node — bottleneck je jinde |
| Desítky/stovky souběžných matchů na jednom fyzickém serveru | Zvážit Rust/Go pro server proces (nižší memory overhead per-connection, žádné GC pauzy) |
| Potřeba binárního protokolu místo JSON | Přidat binary serialization (FlatBuffers, MessagePack) — nezávisí na jazyku serveru |
| Fyzika samotná je pomalá | Rapier je již nativní WASM/Rust — přechod jazyka serveru fyziku nezrychlí |
| Chceš deterministický lockstep server pro desítky tisíc matchů | Tam se vyplatí Rust/C++ server s přesnou kontrolou floating point |

Pro DON'T FALL v současném rozsahu (M2, 4-12 hráčů) je racionální doporučení: **zůstat u TypeScript/Node, ale binárně serializovat protokol** (JSON → MessagePack nebo vlastní bit-packed formát), protože to je nejlevnější optimalizace s reálným dopadem na bandwidth a CPU serializace, aniž by bylo nutné přepisovat celý server. Přechod na Rust/Go dává smysl až v okamžiku, kdy měříš konkrétní CPU/memory limit na produkčním serveru s reálným počtem souběžných matchů — ne preventivně.
## 11. Observabilita: vlastní net_graph
Source's `net_graph` je vzorem toho, co je potřeba měřit v reálném čase, aby vývojář (a hráč) rozuměl, proč se hra "cítí lagovaně". Netgraph zobrazuje: fps, ping/latency, velikost posledního příchozího/odchozího paketu, průměrnou bandwidth, server framerate a jeho variance, aktuální lerp (interpolační zpoždění), požadovaný vs. skutečný updaterate/cmdrate, a graf packet loss/choke v čase.[^3][^31][^12]

Pro DON'T FALL doporučený debug panel:

```text
Network:  RTT, one-way latency estimate, packet loss %, snapshot rate,
          input send rate, input ack age, server tick age, interpolation delay

Prediction: predicted tick, latest server tick, acked input tick,
            input buffer length, reconciliation events/min, max correction distance

Entity:   local Character state, ragdoll epoch, remote snapshot buffer length,
          extrapolating yes/no, locally-live Props count, prop correction count
```

Toto přímo navazuje na pole, která už `SimState.ts` a `protocol.ts` obsahují (`lastInputTick`, `bumpSeq`, `teleported`) — jsou to přesně ta data, která potřebuje debug overlay zobrazit, aby bylo vidět *proč* došlo k reconciliaci, ne jen že došlo.[^11][^6]
## 12. Rozhodovací shrnutí pro DON'T FALL
| Otázka | Odpověď a zdroj principu |
|---|---|
| Lockstep, snapshot interpolation, nebo state sync? | State sync pro Character (predikce), snapshot interpolation pro ostatní hráče a Props — lockstep vyžaduje determinismus, který Rapier nemá[^6][^7] |
| Kdo simuluje Props? | Vždy server; klient jen krátce lokálně predikuje Prop, který sám tlačí, s hard-correction[^9][^8] |
| Kdo rozhoduje o Item Box výsledku? | Server, nikdy klient — gameplay RNG musí být sync, ne async[^23][^19] |
| UDP nebo WebSocket? | WebSocket — browser nemá raw UDP, WebRTC je zatím zbytečná komplexnost pro tento rozsah[^26][^29] |
| TypeScript nebo rychlejší jazyk? | Zůstat u TS/Node; optimalizovat protokol (binary), ne měnit jazyk, dokud měření neukáže konkrétní limit |
| Lag compensation? | Ne plošně v M2 — jen fyzikální kontaktní interakce vyhodnocované přímo Rapier solverem, žádné hitscan mechaniky, které by to vyžadovaly[^17] |
| Jak reprezentovat Ragdoll stav? | Epoch counter + cause + bones, nikdy jen boolean — zabraňuje duplicitnímu spuštění efektů na stale snapshotu[^11][^10] |
## 13. Zmenšování zpráv přes transport (bandwidth optimization)
Toto je oblast, kde se ušetří nejvíc bez architektonického rizika — na rozdíl od síťového modelu (kapitoly 1-9), který je nutné navrhnout správně od začátku, kompresi lze doplňovat inkrementálně nad hotový `protocol.ts` beze změny herní logiky.
### 13.1 Delta compression — posílej jen změny
Základní neefektivita: pokud server posílá plný `SimState` (všichni hráči + všechny Props) v každém packetu, i objekty, které se nehnuly, spotřebují bandwidth. Delta compression řeší toto tak, že server track uje poslední potvrzený snapshot per-klient (podle `lastInputTick`/ack) a odesílá jen pole, která se od něj změnila. Herní projekt F-DDrace to implementuje jako systém, kde se server-side historie snapshotů porovnává s nejnovějším acknowledged stavem konkrétního klienta a do packetu jde jen diff.[^1][^2]

Cena této optimalizace je komplexita: server musí držet per-klient historii (kolik snapshotů zpět, aby zvládl i vyšší RTT), a při ztrátě ack packetu musí umět poslat větší baseline update nebo full snapshot jako fallback. Doporučený vzor: udržovat N posledních plných snapshotů (např. posledních 32 ticků při 30 Hz = ~1 s historie) a pokud klient potvrdí starší tick, než je v historii, poslat mu rovnou plný snapshot místo delty.[^3]
### 13.2 Binární serializace a kvantizace — reálné číslo pro DON'T FALL
Aktuální `protocol.ts` posílá čistý JSON text. JSON je čitelný a snadný na debug, ale nese enormní overhead: každé pole má textový klíč, čísla jsou ASCII text místo raw bytů, a struktura se opakuje pro každého hráče a Prop.[^4][^5]

Spočítaná simulace pro realistický `SimState` s 8 hráči a 6 Props (pozice, rychlost, motionState, checkpoint, fallCount, teleported, dash cooldown, dashing, dashSpeed, lastInputTick, bumpSeq) dala následující srovnání:

| Formát | Velikost packetu | Bandwidth/klient při 30 Hz |
|---|---|---|
| JSON (aktuální) | 3 234 B | 94,75 KB/s |
| Bit-packed binary (16bit fixed-point pozice, enum jako 3 bity, boolean jako 1 bit, delta-encoded tick) | 245 B | 7,18 KB/s |

To je přibližně 13× zmenšení jen díky binárnímu formátu bez ztráty přesnosti relevantní pro hru — pozice kvantizovaná na 16bit fixed-point dává rozlišení v řádu milimetrů na herní ploše rozumné velikosti, což je pro Rapier physics vizuálně nerozeznatelné od plné float64 přesnosti. Automatizovaná studie komprese síťových dat pro online hry (Herrmann, 2016) potvrzuje, že quantizace floatů na fixed-point s vhodným rozsahem bitů je jedna z nejúčinnějších a nejlevnějších optimalizací, protože nevyžaduje změnu herní logiky, jen serializační vrstvu.[^6][^7]

Praktický krok pro DON'T FALL: nahradit `JSON.stringify(SnapshotMessage)` binárním encoderem (ručně psaný bit-packer nebo knihovna jako MessagePack/FlatBuffers), zachovat JSON jen pro `WelcomeMessage` (jednorázová zpráva, kde velikost nehraje roli) a pro debug/dev mode.
### 13.3 Priority accumulator — komu pošlu co, když nemůžu poslat vše
Fiedlerův model pro state synchronization: každý objekt má prioritní skóre, které roste s časem od posledního odeslání; server v každém packetu vybere jen top-N objektů s nejvyšší prioritou, ne všechny. Objekt, který se právě pohnul rychle nebo je blízko hráči, může mít vyšší základní váhu než statický Prop v klidu. Toto je přímo relevantní, pokud DON'T FALL v budoucnu rozšíří počet Props na desítky/stovky za match — u 6-10 Props při 12 hráčích to není nutné, ale při scale-up (větší Tracky, více interaktivních objektů) se to stává nutností, aby packet velikost zůstala konstantní bez ohledu na počet objektů ve světě.[^6]
### 13.4 WebSocket permessage-deflate — kdy pomáhá a kdy škodí
WebSocket protokol podporuje kompresní extension (RFC 7692, permessage-deflate) přímo na transportní úrovni, bez úpravy aplikačního kódu. U opakující se JSON struktury (stejné klíče "position", "velocity", "motionState" v každé zprávě) může komprese ušetřit přes 80% velikosti.[^8][^9]

Nicméně existuje kritický caveat pro DON'T FALL use case: permessage-deflate má fixní CPU a paměťovou cenu per-socket (kontext takeover udržuje kompresní slovník mezi zprávami) a u **malých, velmi frekventních zpráv** (30 Hz, řádově stovky bajtů) může overhead komprese/dekomprese převážit úspory na bandwidth — u zpráv pod ~1 KB se běžně doporučuje nastavit `threshold`, pod kterým se komprese vůbec nepoužije. Pro DON'T FALL to znamená: **pokud přejdeš na binární protokol (13.2), permessage-deflate pravděpodobně nepomůže** — binární bit-packed data mají už nízkou entropii redundance, kterou by DEFLATE mohl využít, takže komprese by jen přidala CPU cenu bez úspory. Deflate má smysl hlavně dokud zůstáváš u JSON a nechceš investovat do binárního serializeru.[^10][^11]
### 13.5 Kombinovaný dopad
Pořadí priority implementace podle poměru přínos/náklad pro DON'T FALL:

1. Binární serializace + kvantizace (13.2) — největší jednorázový zisk (~13×), nízké riziko, žádná změna herní logiky.
2. Delta compression (13.1) — druhý největší zisk, ale vyžaduje per-klient state tracking na serveru — implementovat až po binárním formátu, ne před ním.
3. Priority accumulator (13.3) — odložit, dokud počet síťovaných objektů reálně neroste nad zvládnutelnou hranici pro plný per-tick sync.
4. permessage-deflate (13.4) — nepoužívat po přechodu na binární protokol; zvážit jen jako rychlou dočasnou záplatu, pokud binární serializer ještě není hotový.
## 14. Škálování infrastruktury bez přepisu síťové vrstvy
Klíčová teze pro tuto kapitolu: **síťový model z kapitol 1-9 (server-authoritative tick, prediction, interpolation, reconciliation) se s růstem hráčské báze nemění. Co se mění, je počet a umístění serverových procesů, které tento model spouštějí.** To je zásadní architektonické oddělení odpovědnosti — "match simulation" logika by měla být čistě nezávislá na tom, kolik takových simulací běží paralelně a kde.
### 14.1 Jednotka škálování je match, ne hráč ani CPU
Produkční poznatek od inženýrů provozujících Agones na Kubernetes: "nejtěžší část provozování multiplayeru na Kubernetes je přijmout, že jednotka, kterou chceš skálovat, je *room* (match) — ne pod a ne CPU". Jeden serverový proces hostuje jeden match s fixním počtem hráčů (u DON'T FALL 4-12); škálování na víc souběžných hráčů znamená spustit víc *instancí* tohoto procesu, ne zvětšit jednu instanci.[^12][^13]

To přímo odpovídá tomu, jak je `RapierSimulation`/`main.ts` navržen — jeden proces = jeden `SimState` = jeden tick loop pro jeden match. Tento model se nerozbíjí při 100 nebo 10 000 současných hráčích, protože každý match zůstává izolovaná jednotka; roste jen počet procesů.
### 14.2 Node.js: cluster mód pro víc matchů na jednom stroji
Node.js `cluster` modul umožňuje spustit víc procesů, které sdílí stejný port a jsou distribuovány master procesem přes IPC. Doporučený vzor pro víc souběžných DON'T FALL matchů na jednom fyzickém/virtuálním serveru: jeden cluster worker process per CPU jádro, každý worker hostuje N matchů (rooms) podle kapacity. Worker threads (na rozdíl od cluster) jsou určené pro CPU-bound synchronní operace v rámci jednoho procesu, ne pro izolaci celých matchů — pro DON'T FALL je model "jeden proces/worker = několik izolovaných room instancí" praktičtější než jeden worker thread na hráče.[^14][^15]

Reálný vzor z komunitní diskuze: WebSocket-facing server v cluster módu přijímá spojení a routuje je podle room ID na správnou herní smyčku, zatímco herní stav (pokud je potřeba sdílet mezi procesy) se ukládá do Redis pro pub/sub mezi instancemi. Pro DON'T FALL v jednoduchém nasazení (matche jsou vzájemně nezávislé, žádná cross-match komunikace) tato Redis vrstva není nutná — každý match žije čistě v paměti jednoho procesu, dokud neskončí.[^14]
### 14.3 Orchestrace: Agones/Kubernetes vs. GameLift
Existují dvě hlavní produkční cesty pro škálování dedicated servers, obě řeší přesně tento problém "spusť víc instancí stejného procesu, když je poptávka":

| Řešení | Model | Klíčová vlastnost |
|---|---|---|
| Agones (Kubernetes) | Self-hosted, open-source | `GameServer`/`Fleet` CRD, buffer autoscaling policy podle poptávky[^16][^17] |
| AWS GameLift Servers | Plně managed | FlexMatch matchmaking, až 50 herních procesů na instanci, autoscaling podle `PercentAvailableGameSessions`[^18][^19] |

Agones udržuje "warm pool" — vždy několik `Ready` instancí připravených, aby noví hráči nečekali na cold start nového procesu, a škáluje tento pool podle predikované poptávky, ne podle aktuálního CPU. Produkční zkušenost s Agones ukazuje vzor "room-aware" fleetu: jeden pod/proces může hostovat víc rooms najednou (až po nakonfigurovaný ceiling), takže se neplatí cold-start cena za každý nový match, pokud existující proces má ještě kapacitu.[^12][^20]

AWS GameLift Servers dělá totéž jako plně managed služba: fleet instancí, kde každá běží až 50 herních procesů, FlexMatch pro matchmaking podle latence a skill, a autoscaling politika udržující rezervní kapacitu (typicky 10-30% podle předvídatelnosti zátěže). GameLift navíc řeší **geografické umístění** — queue automaticky vybírá server v regionu s nejnižší latencí pro danou skupinu hráčů.[^18][^21][^19][^22]

Pro DON'T FALL: Agones dává smysl, pokud už provozuješ Kubernetes nebo chceš plnou kontrolu nad infrastrukturou a nulové vendor lock-in; GameLift dává smysl, pokud chceš rychlejší cestu k produkci bez správy Kubernetes clusteru a jsi ochotný platit AWS provizi za správu.
### 14.4 Geografické umístění a matchmaking latence
Škálování nejsou jen instance — je to i **kde** běží. Doporučení z produkční analýzy serverových lokací: cílem není minimalizovat latenci na absolutní nulu, ale navrhnout hru tak, aby fungovala dobře v širokém rozsahu latence (ideálně 0-100 ms), a pak umístit jeden dobrý server per region, ne desítky lokací per region. Přílišné množství lokací vede k "latency divergence" — hráči se přehazují mezi městy a zažívají nekonzistentní zkušenost z matche na match.[^23]

Pro DON'T FALL to znamená: matchmaking by měl grupovat hráče podle regionu (měřený RTT k několika kandidátním serverům), ne podle absolutní geografické blízkosti, a fixní tickrate 30 Hz (kapitola 1) už je dostatečně tolerantní k 0-100 ms rozsahu, pokud je interpolační delay (kapitola 4) nastaven konzervativně.
### 14.5 Vertikální vs. horizontální škálování pro jeden match
Důležité rozlišení: **jeden match se neškáluje horizontálně** — 12 hráčů v jednom Rapier world běží v jednom single-threaded tick loopu, protože fyzikální simulace je inherentně sekvenční závislost (kolize hráče A ovlivňuje frame, ve kterém se řeší kolize hráče B). Pokud by DON'T FALL v budoucnu chtěl podstatně větší matche (50+ hráčů v jednom sdíleném světě), to by vyžadovalo skutečnou změnu architektury — sharding world prostoru mezi víc procesů s interest management (podobně jako MMO), což je fundamentálně jiný problém než "víc současných menších matchů". Pro plánovaný rozsah DON'T FALL (4-12 hráčů na match) toto nehrozí — horizontální škálování počtu *matchů* (kapitoly 14.1-14.3) plně řeší nárůst celkové hráčské báze bez potřebyměnit síťový model z kapitol 1-9.
### 14.6 Shrnutí: co se nemění a co se mění při růstu
| Aspekt | Zůstává stejné při růstu | Mění se při růstu |
|---|---|---|
| Síťový protokol (kap. 1-9, 13) | Ano — tick rate, prediction, interpolation, binary format | Ne |
| Kód jednoho match serveru | Ano — stejný `RapierSimulation`/`main.ts` | Ne |
| Počet běžících instancí | Ne | Ano — roste s poptávkou |
| Orchestrace/deployment | Ne — jednou nastavený Agones/GameLift pipeline | Ano — autoscaling politika se ladí podle reálné zátěže |
| Geografické umístění serverů | Ne, pokud matchmaking dobře navržen | Ano — přidávají se regiony podle distribuce hráčů |

---

## References

1. [Snapshot Delta Compression | fokkonaut/F-DDrace | DeepWiki](https://deepwiki.com/fokkonaut/F-DDrace/8.4-snapshot-delta-compression) - Snapshot delta compression is the bandwidth optimization system that minimizes network traffic by tr...

2. [Network Objects and Snapshots | fokkonaut/F-DDrace | DeepWiki](https://deepwiki.com/fokkonaut/F-DDrace/8.3-network-objects-and-snapshots) - This page documents the snapshot-based state synchronization system used by F-DDrace to transmit gam...

3. [In snapshot-based networked game does client store N ...](https://gamedev.stackexchange.com/questions/100978/in-snapshot-based-networked-game-does-client-store-n-snapshots-as-well) - I understand that in a snapshot-based network replication system the server holds onto N full snapsh...

4. [protocol-5.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/baf56a98-7270-450c-b516-03aca80cdb4b/protocol-5.ts?AWSAccessKeyId=ASIA2F3EMEYE64OZJ3TW&Signature=UUs6v0BK0%2BULiIEEKVN55hp1dqE%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJGMEQCIDSTu%2BN4oXWGNaaHwv5x5KabseTZ6V0fRNSt1H4K1MzuAiBIzb7mITHnVbAu2gA74VDlHqPUcgIp1n%2FYjgjcz9B4SCr8BAi2%2F%2F%2F%2F%2F%2F%2F%2F%2F%2F8BEAEaDDY5OTc1MzMwOTcwNSIM%2FJ2Uji0lT5VG8h9JKtAEHA7yPg%2FAqwX3Uiy5sFXr6%2FSKmRnyO0YMRXm8VdsmT9%2B9HMDBNmFkrIBSUhXt2unz9MYXm6H5ZizNyDWGKUpRXL2fm85VJ6ksSoCUzuQZcdzGtmpmuvdzLD2GY%2BnjXxFxddbVvpIHEyko06lg1EAXG7eaKO8R3LLE6byk5T3Ly0HQUoT6D2Mgvj28Tgu1Emouk4%2F3B%2BB2zFySvjOS5OJXSeKhIvts66eR6%2FjJ6PbFT00aUxFxnzOD8pjzpgdhmxohhJiaZ6WJvVjQjibsT01%2Fbw%2F3RAfu39sSHaL6cRR4a2PEpq%2B7qfMYIapfqsp9P%2BvRNSrDqRZYCgZv0RK76PnQcqqo3b0fuUuejRTcUvXW0iAcEYjzPLPoZuMod5yJY0AN3OVT7krOZDSj3SnEby%2BrqG7pzvSvSWRkddhpwMaHO29B65gIu9mzgldCaRpoUgSKM3sZ6eVFitAA35Tczzk%2FeA5yEYOYNXDNSuWBG%2BKmF1QhtPiRL%2F1Nancp%2BxOn98DOSvpbIHUxrVNjqJuiDs3vtjYNvhnqYDtxcA4kmWXRUBpaoCNd84gEhpHMZhRqhsGkvKMQxn6hWe80k4RTftOkNfq%2B3px34BvUnZsspefE1EMiUB6v0YPdrltIEls9cRlCjXxsXBwKurmRGs%2BjYNFqYxun4E%2BSunPNKusCqwaoe3hwCR4EnhRox524ZYJ8DlrlYFRsejNxmLMx23D07tVo3xJXvOBnNfTU5lFWkBW8myYJzLdXSKdweMtDd8zn%2Fw0VuRVHfbq0RpqyoD4KDjuzpTDs89zUBjqZASfJ3dLQesKGalCxZMTqDnGbQZFD6e7QFo%2B9Y%2BPMyiFkrAb1DMis5U2Zogu899Ozd29rNbJtW%2BWJ7UtG%2B0PTEpxwyClAfVJXGDBouRfcZPPKLftDtxF4d%2FCkGjuWuTwXl9rCbqdndSmf9F1UGRdSZ5sp674Dcj1tNI1xCDxSWc5KxruQzDQbFGuzMck9zC98n5Ol%2FN%2ByD18ZFQ%3D%3D&Expires=1788299199) - import type { Vec3 } from "../math/vec3.js";
import type { SimInputs } from "../simulation/SimInputs...

5. [Compression - websockets - Read the Docs](https://websockets.readthedocs.io/en/latest/topics/compression.html) - Most WebSocket servers exchange JSON messages because they’re convenient to parse and serialize in a...

6. [State Synchronization](https://gafferongames.com/post/state_synchronization/) - Introduction Hi, I’m Glenn Fiedler and welcome to Networked Physics. In the previous article we disc...

7. [[PDF] Automated Network Compression for Online Games](https://theses.fh-hagenberg.at/system/files/pdf/Herrmann16.pdf)

8. [WebSocket Per-message Compression](https://datatracker.ietf.org/doc/html/draft-ietf-hybi-permessage-compression-00) - This specification defines a WebSocket extension that adds compression functionality to the WebSocke...

9. [Compression - websockets 17.0.1 documentation](https://websockets.readthedocs.io/en/stable/topics/compression.html) - Compressing messages can reduce network traffic by more than 80%. websockets implements WebSocket Pe...

10. [permessage-deflate Compression Trade-offs - RTWebSocket.com](https://www.real-time-websocket.com/real-time-protocol-selection-architecture/message-framing-and-serialization/permessage-deflate-compression-trade-offs/) - When WebSocket compression pays and when it costs you: per-socket zlib memory, context takeover, CPU...

11. [When to use websockets perMessageDeflate?](https://stackoverflow.com/questions/45394867/when-to-use-websockets-permessagedeflate/45398478) - I have been unable to find good information as to the usefulness/practicality of the perMessageDefla...

12. [Scaling multiplayer game servers with Agones on Kubernetes](https://kaushikrb.com/blog/agones-multiplayer-scaling) - Allocate rooms, re-use warm pods, scale by room count. The architecture behind a Kubernetes-native m...

13. [Using Agones to Easily Create Scalable Game Servers](https://gist.github.com/MansiAyer/acf49f69ba4db8775316d3f03be30710) - GitHub Gist: instantly share code, notes, and snippets.

14. [Worker thread vs cluster with Websockets](https://www.reddit.com/r/node/comments/11p9hhc/worker_thread_vs_cluster_with_websockets/)

15. [Cluster | Node.js v26.8.1 Documentation](https://nodejs.org/api/cluster.html)

16. [GitHub - googleforgames/agones: Dedicated Game Server Hosting and Scaling for Multiplayer Games on Kubernetes](https://github.com/googleforgames/agones) - Dedicated Game Server Hosting and Scaling for Multiplayer Games on Kubernetes - googleforgames/agone...

17. [Autoscaling Concepts](https://agones.dev/site/docs/advanced/scheduling-and-autoscaling/) - Scheduling and autoscaling go hand in hand, as where in the cluster `GameServers` are provisioned im...

18. [Deploy a Multiplayer Game Server With AWS GameLift [2026]](https://tech-insider.org/deploy-multiplayer-game-server-aws-gamelift-2026/) - Step-by-step tutorial to deploy a multiplayer game server on AWS GameLift in 2026: fleets, FlexMatch...

19. [Scale Amazon GameLift Servers container fleets](https://docs.aws.amazon.com/gamelift/latest/developerguide/containers-scaling.html) - Learn how to effectively scale Amazon GameLift Servers managed container fleets by adjusting fleet c...

20. [Making and Scaling a Game Server in Kubernetes using Agones](https://noe-t.dev/posts/making-and-scaling-a-game-server-in-k8s-using-agones/) - Learn with me how to create a game server in Go for Agones, deploying it on Kubernetes, designing an...

21. [Dedicated Game Server Hosting - Amazon GameLift FAQs](https://aws.amazon.com/gamelift/servers/faqs/) - If you are looking for services to build and manage game backend features on AWS, we recommend explo...

22. [Dedicated Game Server Hosting - Amazon GameLift](https://aws.amazon.com/gamelift/) - Amazon GameLift Servers helps you deploy, operate, and scale high-performance dedicated game servers...

23. [Planning server locations for your multiplayer game](https://mas-bandwidth.com/planning-server-locations-for-your-multiplayer-game/) - The more player server locations you have, the lower the average latency will be, but also the small...


---

## References

1. [RapierSimulation-3.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/ac9aaa25-804d-425e-80bd-d4ea12bd1ea7/RapierSimulation-3.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=qhS%2BW5e02L7RYbetWVvPmK3hWQA%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934) - import RAPIER from "@dimforge/rapier3d-compat";
import { pointInBox, type Box } from "../math/box.js...

2. [Ragdoll-4.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/a8cd92a9-3d91-44d5-9aac-3563982a4d01/Ragdoll-4.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=A6noN40Ru%2BYbxqEJrZm2wsrtoZU%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

3. [proposal.md](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/68c0a1f1-f7c8-4138-b62a-9a5f4da7a9b6/proposal.md?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=Py96yccWCF4niul7yG8Pd4dbZC8%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

4. [Introduction to Networked Physics | Gaffer On Games](https://gafferongames.com/post/introduction_to_networked_physics/) - Hello readers, I’m no longer posting new content on gafferongames.com Please check out my new blog a...

5. [CONTEXT-3.md](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/4649dc78-5338-4b6d-9b45-ca70a807d3ff/CONTEXT-3.md?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=x%2FbZ7kfuxEJmfI0DYVxVfgu2Oq8%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

6. [protocol-5.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/baf56a98-7270-450c-b516-03aca80cdb4b/protocol-5.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=0vev2Q0oBmqLJMePLXVn5H7jDPU%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934) - import type { Vec3 } from "../math/vec3.js";
import type { SimInputs } from "../simulation/SimInputs...

7. [Game Backend Deep Dive - Overwatch](https://edgegap.com/blog/game-backend-deep-dive-overwatch-2016-netcode-architecture-rollback) - Read all about Game Backend Deep Dive - Overwatch on Edgegap's blog.

8. [State Synchronization](https://gafferongames.com/post/state_synchronization/) - Introduction Hi, I’m Glenn Fiedler and welcome to Networked Physics. In the previous article we disc...

9. [Unity-UltimateGloveBall/Documentation/BallPhysicsAndNetworking.md at main · oculus-samples/Unity-UltimateGloveBall](https://github.com/oculus-samples/Unity-UltimateGloveBall/blob/main/Documentation/BallPhysicsAndNetworking.md) - Meta Quest ESport Showcase demonstrating multiplayer functionalities in Unity. Including Oculus Soci...

10. [collisionGroups-2.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/7fe8b481-c58c-4855-bdd6-0c0c77a2723b/collisionGroups-2.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=FSpyY97OdqgYme4iasevgFasP7o%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

11. [SimState-4.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/2b29c6b7-f7be-40c4-ac40-5237fbc70c60/SimState-4.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=NPb%2FXrgbZTMIQAL9n5gCUH2HDaU%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934) - import type { Vec3 } from "../math/vec3.js";
import type { CharacterMotionState } from "../simulatio...

12. [Prop-5.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/8ea3019c-f075-40e5-976c-8042014dcf52/Prop-5.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=qJAGE9pv6YLoe27xt3d2lFyT5dM%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

13. [Network Physics | Spatial Creator Toolkit](https://toolkit.spatial.io/docs/multiplayer/network-physics) - Learn how Spatial synchronizes physics across clients and how to optimize your physics for multiplay...

14. [V3 Shared Authority - Ownership Modes | Photon Engine](https://doc.photonengine.com/fusion-godot/current/manual/replication/ownership-modes) - Authority determines which client is allowed to write a networked object's properties. Only the auth...

15. [Fusion Core — Ownership | Photon Engine](https://doc.photonengine.com/fusion-core/v3/manual/ownership) - Every networked object in Fusion has exactly one owner at any time. The owner is the client that has...

16. [Networked Physics - Normcore.io](https://docs.normcore.io/realtime/networked-physics) - RealtimeTransform synchronizes the state of the object from the owner to all other clients. Realtime...

17. [CharacterController.ts](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/a35f95c0-1c33-4bef-811c-eaea5cade076/CharacterController.ts?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=LwyxaN0vK%2FLH9ak%2FLkvTjwNKwag%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

18. [Screenshot-2026-09-01-at-2.08.17-PM.jpg](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/images/57250901/8532f42d-808f-40ad-90ae-c6aabae6afd0/Screenshot-2026-09-01-at-2.08.17-PM.jpg?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=9Yxl4aPhA%2FVwKSzGidgoeJBeqiw%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)

19. [Deterministic Game Simulation for Multiplayer Games](https://daydreamsoft.com/blog/deterministic-game-simulation-for-competitive-multiplayer-ensuring-fair-and-synchronized-gameplay) - Learn how deterministic game simulation powers competitive multiplayer games by ensuring synchronize...

20. [Determinism and Desyncs | rwmt/Multiplayer | DeepWiki](https://deepwiki.com/rwmt/Multiplayer/6-determinism-and-desyncs) - This page documents the deterministic gameplay system and desync detection capabilities of the RimWo...

21. [Seeds and Deterministic Generation - Abratabia](https://www.abratabia.com/procedural-generation/seeds-and-determinism.php) - How seed values make procedural generation deterministic and reproducible. Covers pseudorandom numbe...

22. [Where does uranium generation get its random numbers from?](https://www.reddit.com/r/factorio/comments/7bs27o/where_does_uranium_generation_get_its_random/) - Where does uranium generation get its random numbers from?

23. [Modder's guide to multiplayer safe code](https://forums.civfanatics.com/threads/modders-guide-to-multiplayer-safe-code.477472/) - In this post I will give some detailed information about how the multiplayer synchronization works i...

24. [What are the differences between UDP and WebSockets, and which type of games benefit from which?](https://www.reddit.com/r/gamedev/comments/ugpev5/what_are_the_differences_between_udp_and/) - What are the differences between UDP and WebSockets, and which type of games benefit from which?

25. [TCP, UDP, WebSocket Explained - CodeSmile](https://codesmile.de/2024/07/24/tcp-udp-websocket-explained/) - How come networked games rely almost exclusively on the UDP protocol to exchange data packets? And w...

26. [Can I make Websocket multiplayer games for any genre ?. - GameDev.net Forums](https://gamedev.net/forums/topic/709444-can-i-make-websocket-multiplayer-games-for-any-genre/) - Hello,I'm guessing the answer to this question depends on the game. As far I've read so far (and I m...

27. [UDP Latency and Loss Rate Analysis | PDF](https://www.scribd.com/document/895017179/Protocol-Latency-Loss-Comparison) - The document presents a comparison of latency and loss rates across different protocols (UDP, WebSoc...

28. [Huge latency when using Websockets?](https://discussions.unity.com/t/huge-latency-when-using-websockets/945043) - Hello, I am developing a webgl game and need to use websockets, but I ran a simple test and I am see...

29. [A comprehensive dive into WebRTC for client-server web games](https://blog.brkho.com/2017/03/15/dive-into-client-server-web-games-webrtc/)

30. [WebSockets, UDP, and benchmarks - Stack Overflow](https://stackoverflow.com/questions/13040752/websockets-udp-and-benchmarks) - HTML5 websockets currently use a form of TCP communication. However, for real-time games, TCP just w...

31. [CLAUDE-2.md](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/57250901/9bb9167c-6a7c-4262-8c53-b6b590fb72b5/CLAUDE-2.md?AWSAccessKeyId=ASIA2F3EMEYE227QAH4N&Signature=DroEZY2HNM4MyeA3GtqH%2BPiEWGk%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEO3%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC%2BtiB8wCwjOCS3TJujtqNnWurtBzc3y9HjT8%2FtxHD4TgIgWpBe7axuXRNihTdsRsaHXr90%2F6rjpqFjy6sFvodMTtEq%2FAQItv%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDGx1If0mktDElL7aNSrQBJvrc8A96Z6g0DDJUP1N2Fqv6eFUO2WxtM9%2BNb2zay3DEz%2BW0qQLqE4QbV39oyVxgHaXtx2aPeYWSgYfAYxIgBoRXgde%2BQ4QdmJFc31uRg25SGfH9MCrD7hm7NRWTLOas%2FARlXfbN6vOskTBjWb5%2BdpHsm25Ys9rC9aQ76PE0krnDk0%2BDpQWJGHVyxkmR1T0OFW92XdrQyp6UpUXNPJFyTDUXTS74GWGlVgouNYuk%2F1FuSd9OwZlISEmM2s1c3IpeRpE5DffHRYHnt3cquBwxmzlzn9zWciy5igP7IKkXPIzgeJ6Ijh4k2vRsj9WgIcFfoq7LSN88syIULKU6yzSvfD5vztPgRmMxuvnJYfMbj66hYzvgcuHfwxfJa%2BO0OgofS7MTMjwpsn3FUQ%2FFo1SXPf4Nhzzl2%2B3tc%2F2Wqpt0alH1oMZRFQWBab7qiWCZqpVQ7Ue6efUDDVL8qCeznNhP7hXvGbQKfrUFYI4MQw4m0h8nj1Ut76vtfx5AtDq%2B45ulgbddevVTFcgyGrlkZkSY8Yh55GW8yqgrGq%2FIhGicEwGv3IBJO4%2FI61Peq%2FmjU8G8AtbPKneDqONSgSxFN4bA7YJKFL4XjLbtNWfHMbMBdinoH77pSOZk4eyN28Ga9xQIw474b6bod6UK0nz7KkaF9dRaO7w84mnq5WyKK2eG4qz9dP4U4wPdrTUlFo79lzkV1h4SX6fEWXbmfLdd2DFDUzKNwdnfKdaorfIdjcGMbBEqD%2B50qZb3ttNFIE4yI3yCM11eVDLEsVnls1T6DZoqbIw4%2FHc1AY6mAHF8OTTQiLGianC4GZZ8ThXAP4cNnByDmTWidjkOqKMT9ByoVmYP90%2Bbtn3GAAfXjg773Ztx55CHoDGrTPm2zSo5RO5IFIq3av5%2F0%2FB8fWCw6yByM2s6g%2BmBmi1jccdwvp13Aay660024YtgUAjeg2EYzX0jEdfslUr68MkO168lHMMwfzBKp26c%2Fp5grNnjCdY%2Be3PgWKNxA%3D%3D&Expires=1788298934)
