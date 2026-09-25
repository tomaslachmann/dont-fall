# Animované bomby BLIP

- `kaykit_bomb_A_blue_animated.glb`
- `kaykit_bomb_B_blue_animated.glb`

Obě varianty zachovávají původní modré provedení a materiál bomby. Výbuch je prostorový efekt z animovaných objektů: standardní GLB transformace a morph animace. Tlakové vlny se plynule ztenčují pomocí morphu `Dissolve`. Není potřeba vlastní shader ani rozšíření Animation Pointer.

| Klip | Délka | Přehrávání |
| --- | ---: | --- |
| `Bomb_Tick` | 1,0 s | Běžné pulzování, smyčka |
| `Bomb_Tick_Fast` | 0,4 s | Rychlé varování, smyčka |
| `Bomb_Explode` | 2,1 s | Výbuch, jednou |

**Detonace nastává 0,14 s po spuštění `Bomb_Explode`.** V tomto okamžiku hra řeší zásah hráčů a vypne collider. Vizuální efekt dobíhá do konce klipu.

## Three.js

`BombAnimations.js` importuje balíček `three`. Každá bomba potřebuje vlastní instanci scény a pomocníka. `gltf` níže je výsledek `GLTFLoader`.

```js
import { createBombAnimations } from './BombAnimations.js';

const bomb = createBombAnimations(gltf, {
  onDetonate: () => {
    // Zde jednou vyhodnoť zásah a vypni collider v Rapieru.
  },
  onFinished: () => {
    // Efekt skončil; instanci lze vrátit do poolu.
  },
});

// Pomocník začne běžným tikáním. Při změně stavu:
bomb.tick(true);  // Rychlé varování.
bomb.explode();   // Jednorázový výbuch; opakované volání se ignoruje.

// Každý snímek, dt v sekundách:
bomb.update(dt);

// Při opětovném použití po výbuchu:
bomb.tick();

// Při definitivním odstranění instance:
bomb.dispose();
```

Volání v ukázce představují různé události hry, nepouštěj je všechna za sebou. `onDetonate` se vyvolá právě jednou pro každý spuštěný výbuch i při velkém `dt`; zahájení ani samotné tikání jej nespouští. `tick()` ukončí předchozí klip, obnoví scénu a vynuluje příznak `gltf.scene.userData.bombSpent`. Při detonaci je příznak `true`; po skončení se celá scéna skryje. Fyziku a collider při vrácení z poolu obnovuje hra. `dispose()` scénu skryje a uvolní animační vazby; sdílené materiály a geometrii nemaže.

## Umístění a kolize

Pivot celého assetu je na zemi, osa Y míří vzhůru. Pulzuje vizuální uzel `Bomb_Pulse`; objekty efektu mají prefix `FX_`. Původní metadata `solid_0_hull` zůstávají pevná pro vytvoření collideru — jeho body již mají správnou výšku od země, nepřičítej znovu 0,4. Duplicitní vykreslovaná kolizní síť je z těchto GLB odstraněná. Pohyb a otáčení bomby z Rapieru aplikuj na nadřazenou instanci, nikoliv na animovaný `Bomb_Pulse`.

Pomocník během tikání vypíná viditelnost celé skupiny `Bomb_FX` a při výbuchu ji znovu zapíná. Při tikání tak zůstává 5 vykreslovaných mesh objektů, během výbuchu až 46, po skončení žádný. Jde o počty pro základní průchod; stíny přidávají další práci. Samotný GLB funguje ve vieweru bez pomocníka: efekty mimo výbuch skrývá animované měřítko. Nulové měřítko samo o sobě nezaručuje úsporu vykreslovacích volání.

Všechny klipy explicitně resetují transformace a morph váhy včetně efektů. Při ručním přehrávání nastav tikání na `LoopRepeat`, výbuch na `LoopOnce` s `clampWhenFinished = true` a zastav souběžné tikací akce. Jednotlivým efektům ručně nenastavuj `visible = false`, protože samotný GLB klip tuto vlastnost nezapne; přepínání skupiny `Bomb_FX` zajišťuje pomocník. Po výbuchu nezastavuj akci bez skrytí celé instance — zastavení může obnovit původní viditelnou bombu.


## Zdroje a náhled

Oba soubory `.blend` se otevřou s připraveným výbuchem na časové ose, snímky 1–64 při 30 fps. Tikací akce jsou zachované ve zdroji. GLB již obsahují tři samostatné pojmenované klipy pro hru.

`Bomb_Animation_Preview.mp4` a `.gif` ukazují běžné tikání, rychlé tikání a výbuch varianty A; varianta B používá stejný efekt. Náhled má studiové osvětlení a jemnou záři. Ve hře vzhled přizpůsobí její osvětlení a nastavení bloom.

Oba finální GLB byly načtené a otestované ve skutečném Three.js AnimationMixeru: názvy klipů, návaznost smyček, morph váhy, zachování pevného collideru, dokončení výbuchu a opětovné použití instance.
