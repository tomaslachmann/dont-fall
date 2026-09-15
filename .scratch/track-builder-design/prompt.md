# Design prompt: Track builder (DON'T FALL)

> NOTE (2026-09-15): the "vanilla DOM + CSS, bez frameworku" constraint below
> was superseded during implementation — the user directed a React shell like
> the client's instead (ADR 0063). The inventory (sections A–F) still stands
> as the coverage checklist; only the implementation tech changed.

> Zkopíruj celý text pod čarou do Claude Design. Sepsáno podle skutečného
> stavu `apps/track-builder` (září 2026) — každá položka checklistu je reálný
> ovládací prvek, který dnes v builderu existuje.

---

Jsi UI/UX designer. Navrhni redesign **Track builderu** — interního autorského
nástroje pro skládání tratí ve hře DON'T FALL (chaotická multiplayerová
obstacle-racing hra pro prohlížeč, Fall Guys je reference jen pro strukturu
zápasu, nikdy pro feel).

## Co nástroj je a kdo ho používá

- Track builder je **vývojářský nástroj**, ne herní obrazovka: používá ho
  autor tratí (často sám vývojář) k sestavení trati z Modulů, jejímu uložení
  na API a playtestu v reálné hře.
- Priorita je **hustota, přehlednost a rychlost práce**, ne marketingový wow.
  Tmavé editorové téma (dnes `#0b0e14`, panely `#10141c`, akcent `#4a90d9`).
- Implementace je **vanilla DOM + CSS + Three.js, bez frameworku** (Vite, jeden
  `index.html` + TypeScript). Navrhuj tak, aby to šlo postavit v čistém
  CSS/DOM — žádné React komponenty, žádné těžké UI knihovny.
- Herní klient má vlastní design kit (`packages/ui`, design-tokeny z M9).
  Builder s ním má být **vizuálně příbuzný** (fonty, akcenty, radiusy), ale je
  to nástroj — dovoleno být hutnější a techničtější.

## Dnešní layout (informační architektura, kterou držíme)

Tři regiony, neměnit jejich smysl, jen vzhled a uspořádání uvnitř:

1. **Paleta vlevo** (dnes 220 px, scrollovatelná) — zdroj dílků.
2. **3D viewport uprostřed** (Three.js, orbit kamera, grid podlaha) — sestavená
   trať + overlaye.
3. **Toolbar dole** — napojení na API, undo/redo, metadata trati, status.

## Kompletní inventura — na nic z toho nesmíš zapomenout

### A. Paleta (levý sloupec)

- Nadpis „Modules".
- **Dva taby: Procedural / Assets** — přepínají dva seznamy.
- **Procedural tab:** cca 15 procedurálních Modulů, každý záznam = malý 3D
  náhled (auto-framed, 3/4 kamera, točí se) + název. Klik = položit na konec
  trati (řetězení přes Sockety).
- **Assets tab:** pod-tab **kategorie: Platform / Obstacle / Scenery** +
  seznam asset Modulů s náhledy renderovanými z **načtených GLB vizuálů**.
  Stavy, které musí mít design: **prázdné (ještě nenačteno), načítání
  (fetch GLB z API při prvním otevření tabu), chyba načítání, prázdná
  kategorie**.
- **Rezerva do budoucna:** assetů budou desítky až stovky (celý KayKit pack +
  další packy). Navrhni škálování už teď: seskupení podle packu, fulltextové
  hledání / filtrování, líné náhledy. Nesmí to zůstat plochý seznam.

### B. Viewport (střed) a jeho overlaye

- **3D scéna:** sestavená trať, orbit kamera (rotate/zoom/pan), grid, tmavé
  pozadí. Klik na Segment = vybrat (žlutý highlight rámeček), klik do prázdna
  = odznačit, **multi-select** (výběr více Segmentů, gizmo na syntetickém
  pivotu, tah hýbe celou skupinou jako rigidním tělesem).
- **Transform gizmo** (three.js TransformControls) na výběru, tři režimy:
  **Move / Rotate / Scale** (scale je vždy uniformní). Při tahu: **socket-snap**
  (default), **Shift = jemná mřížka**; rotace snap po krocích, Shift jemně.
  Během tahu **overlap ghost**: průsvitný box v barvě **zelená = volno /
  červená = překryv s jiným Segmentem** (jen single-select).
- **Selection boxes:** jeden rámeček na každý vybraný Segment.
- **Motion guide** (oranžová/fialová/šipka): u Segmentu s Pohybem (Motion)
  značky kde se točí/klouže — tečka v pivotu + čára podél osy (Spin oranžová,
  Swing fialová), šipka podél Slidu + průsvitní „duchové" koncových poloh.
  Režim **„pick pivot na modelu"** (klikni na část modelu, Esc ruší).
- **Impact tint** (přepínatelný): překryv na pohyblivých/nebezpečných Segmentech
  ve třech pásmech — **zelená nese/tlačí, žlutá stagger, červená knockdown**.
  Stejná barevná řeč se používá i v motion panelu — musí ladit.
- **Motion transport** (plovoucí pruh nahoře uprostřed): tlačítko **Play/Pause**,
  **scrub slider času 0–60 s + label `0.00 s`**, tlačítko **Restart ⟲**,
  checkbox **„impact"** (viditelnost Impact tintu). Titulek vysvětlující, že
  jde o hodiny, podle kterých hrají všechny pohyby.
- **Browse panel** (plovoucí vlevo nahoře, přepínatelný): seznam tratí z API,
  každý záznam **název + id**, klik = načíst. Stavy: načítání, chyba, prázdno.
- **Hint bar** (dole vlevo): tahák zkratek — viz sekce E.
- **Prázdný stav viewportu:** žádný Segment — co vidí autor (prázdný grid +
  výzva k položení prvního Modulu).

### C. Inspector (plovoucí panel vpravo nahoře, jen při výběru)

- Nadpis „Selected" + **label vybraného** (id Modulu, index Segmentu;
  u multi-selectu počet/co je vybráno).
- **Gizmo mód:** tlačítka Move / Rotate / Scale.
- **Rychlá rotace:** tlačítka ↺ 90° / ↻ 90°.
- **Osa rotace pro klávesnici:** Yaw / Pitch / Roll.
- **Duplicate / Delete.**
- **Velikost (scale 0.25–4):** řada preset tlačítek + stepper **− / číselný
  input / +** (Shift = jemný krok).
- **Motion panel** (součást inspectoru, největší kus — viz sekce D).

### D. Motion panel (editor Pohybu, v inspectoru, největší jednorázový kus UI)

Jeden Segment může mít **tři druhy pohybu najednou, každý nezávisle
zapnutelný** (switch), skládají se spin → swing → slide. V UI se pracuje
**ve stupních a sekundách**, data jsou v radiánech — převod je logika, tebe
zajímá jen prezentace.

Společné prvky všech tří sekcí:

- Hlavička sekce s **on/off checkboxem** + tělo polí (skryté když vypnuto).
- **One-click vrstva:** sada „chip" tlačítek přednastavených tvarů, které
  zapnou druh pohybu a předvyplní pole (detailní pole zůstávají pravdou).
- **Věta lidskou řečí** („says" řádek s barevným levým proužkem v barvě
  nebezpečí: zelená/žlutá/červená — stejná řeč jako Impact tint).
- **Easing:** 4 tlačítka s **kreslenou křivkou průběhu** + select + věta
  popisující zvolený průběh.
- **Timing strip** (jen Swing/Slide): miniaturní graf jednoho cyklu —
  průběh obarvený dle nebezpečí, pauzy (holds) zvýrazněné, **tahatelný
  playhead = scrub času**, popisek „one cycle = X s · up = far end · drag
  to scrub", playhead žije s transportem.

Jednotlivé druhy:

- **Spin:** shape chips **Carousel** (toč naplocho o střed), **Arm** (máchni
  o přední konec), **Drum ↕** (roluj podél délky), **Drum ↔** (roluj podél
  šířky); směr **⟲ ccw / ⟳ cw**; **mřížka pivotu 3×3** (pohled shora,
  ▲ = předek: rohy, středy stran, střed) + tlačítko **🎯 pick** (klik na
  modelu); select **osy** (x/y/z); pole **°/s** (rychlost),
  **start°** (počáteční úhel); select **pivot presetu** (…/custom) + xyz pole
  pivotu.
- **Swing:** shape chips **Pendulum** (visí shora a kýve), **Hammer** (máchá
  nahoru/dolů od předku), **Seesaw** (houpe se na středu základny); věta;
  timing strip; mřížka pivotu + 🎯 pick; select osy; pole **±°** (amplituda),
  **period s**, **pause s**, **phase**; easing.
- **Slide:** věta; timing strip; pole **offset xyz**; **period s**,
  **pause s**, **phase**; easing.
- Multi-select: panel se ukazuje jen pro single-select (nebo navrhni
  rozumné chování pro skupinu a napiš, které sis vybral).

### E. Toolbar (spodní pruh)

Zleva doprava vše, co dnes nese (pořadí můžeš přeskupit, nic nevynechat):

- **API URL input** (default `http://localhost:8081`).
- **Undo / Redo.**
- **Remove last** (odeber poslední Segment).
- **Playtest** (publikuje trať k playtestu a otevírá ji v reálné hře).
- **Track name input.**
- **Time limit (s)** — Round default trati, číslo s min/max.
- **Survivors** — Round default („na kolik se tohle místo hraje dobře dolů"),
  číslo s min/max.
- **Save** (uloží novou Revizi, vrácené id se propíše do id pole).
- **id input + Load** (načti trať dle id).
- **Browse toggle** (otevírá/zavírá Browse panel).
- **Status řádek** vpravo: `N Segment(s)`, hlášky saved/loaded/failed,
  chyby assetů. Musí mít i **chybový vzhled** (ne jen šedý text).

### F. Klávesnice (musí zůstat funkční a zdokumentovaná v hint baru)

Šipky/PageUp/PageDown = posun výběru · `[` `]` = rotace na aktivní ose ·
`−` `=` = změna velikosti · **Shift = jemný krok všude** · Esc = zrušit
pick pivotu · zkratky neplatí při psaní do inputu. Navrhni, kde tahák žije
(dnes hint bar ve viewportu) a jak vypadá.

### G. Rezervy do budoucna (M10 — zatím jen místo v layoutu, ne detaily)

- **Compose mode:** nový režim builderu pro skládání **vnitřku jednoho Modulu
  z primitiv (box/válec)** — klik na primitivum, translate/scale gizmo,
  přidat/smazat/duplikovat primitivum, **duální render** (plný
  zaoblený/barevný mesh + drátěný collider), lokální grid, vstup/výstup do
  režimu (nový draft vs. obsah existujícího Modulu).
- **Compose side panel:** picker primitiva (box/válec), slider corner-radius,
  **color picker + pastel preset swatches**, přepínač osy válce, picker
  surface, modulové defaulty (radius/color/surface), **editace Socketů a
  footprintu bez kódu**, export do registru (export-and-commit flow).
- Nech pro ně v návrhu **pojmenované místo** (tab? mód? panel?), ať redesign
  za půl roku nepraskne.

## Co po tobě chci jako výstup

1. **Popis vizuálního jazyka:** paleta, typografie, radiusy, stíny, hustota;
   vztah k hernímu design kitu (co přebíráš, kde se vědomě lišíš a proč).
2. **Layout všech tří regionů + všech overlayů** (C, D, Browse, transport,
   hint bar) — kde co sedí, rozměry, chování při malém okně (minimální
   rozumná velikost okna).
3. **Komponentu po komponentě** všechno ze sekcí A–F: vzhled, stavy
   (default/hover/active/disabled/loading/error/empty), a u motion panelu
   i rozložení každé sekce (chips, věta, strip, mřížka, pole).
4. **Barevná řeč nebezpečí** (zelená/žlutá/červená) — jedna definice pro
   Impact tint, motion věty i timing stripy, včetně přístupnosti
   (nespoléhat jen na barvu).
5. **Checklist pokrytí:** projdi sekce A–F položku po položce a u každé
   napiš, kde v návrhu je. Položka bez umístění = nedokončený návrh.
6. **Co jsi vědomě změnil** oproti dnešku (pořadí v toolbaru, slučování,
   přesuny) + proč, v pěti větách na změnu max.

## Omezení

- Neměň interakce a logiku (snapy, zkratky, kroky, chování gizmů, datový
  model) — jen vzhled, rozložení a informační architekturu. Kde interakce
  nedává smysl, navrhni alternativu jako **volitelný dodatek**, ne jako
  součást návrhu.
- Žádný světlý režim, žádné frameworkové komponenty, žádné placeholdery
  typu „motion panel zde" — každá položka inventury musí mít konkrétní
  navržené místo a vzhled.
- Cílové rozlišení: desktop 1440px+ primárně, použitelné od cca 1280px.
  Mobil neřeš.
