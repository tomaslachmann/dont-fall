Jo — **tohle je podle mě dokonce lepší směr**. Ne „survival arena“, ale **Fall Guys-like party game**, kde je základ **závod + překážky + vyřazování**, a „nesmíš spadnout“ je hlavní fyzikální princip.

Necháme si tedy chaos, ragdoll a knockback, ale přidáme **reálný závodní loop**.

# 🪂 Pracovní koncept: DON'T FALL

![Image](https://images.openai.com/static-rsc-4/kQQyBfm4SBf_4ktc4I4g7sl6hAv8SKSJLUIYkZrglEfEIMuvoD1DeZ5fRSSW9sOMdI59kWb9_iS-QNXHWHvfuQosSY2u9bcPRZDLKotIY1INt36EsCqRLvk6GXOMfanVWYeSgIvTVFaQaZE5ly3Q7PGG2VFlJAv2OhUYRbW8muUUT80HppQdB45NLAvVVX93?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/vKTWxiSy2lhFlWt3brCmFGPPWCHH834d9iPIS7VllKxPw_lsw_f9ZcXLgAlD2pwWsYeqPJaa7bNF0ZsCi63cJWf6inH8ni40eOO76r_h0eL57Bkdxl2RnkX_YiShrLOPdrYFzmtoBNeKzryj8UAe2Xm3hVba43YE0SDPhYA72gWgbrUJbYxSEBnxRtLDm14J?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/V8E5FMmqQN7RsY__eq4FZjUfJZ8i4DwRRDLo9uR4Ud45RJ9FDA5rzdlklXar7jF1r3s8Gt-NLoq2QSC34VoNqCJO1Xa2jnE5U6Gf8BOG4JWYn-gq4G3RHEVzPJn9ttpDSBEzJHotW3SbduwSTqnikyKAh1DkvUv_Oeo3hpyw9F7T7mnFe9m0_To0yJmcb-fk?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/jAbRMUVT1Qkt-rGfVYCoZu9ntwrOsG7vwYaoOMD-rNYP7RsABNbeSDFugY6Pe3BT1LxU0h5Lir8n1x1psCn8rpwnlg4a_CT4pfSBZo6ETNx3NpnmzTvxudAOxwXJvS2gY5VDQ_V5uhXEmZv0Vldtz58sI0UfFyGI-FWVPFBsxaYPrE2-Ng7ORsSO18PsmRRE?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/RuN0Dva3XqwLqcgmLAMmOAj3AvPJ3ix4_0vFMAgk914c_fNzAEHm8vNBqwm-8kaBwFyLCAMsNxArFl1XEPnfrwlVX4nDLkP61kAPWZkoluMNrPJR0rSAwbo8sg_zEGJV80xCd-3ZD-mFwa5kGTTd3ZIU7eNMqzCUTbF-Qp0zQNVnSsCE2ca036AMewhg9LgB?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/NI1pSRUYVObtwzCtR4Dq8-bSqQdTHWREiCnweLFXqUj1JftORVz5PnA9Qi5YN3Q8SuutPsWkJ0nDzOlmglm2-YBwia5RMQ2DV9ltHQGTycOEoVZREBq_fjQ-c10VPW6BOFZ_2LEAPS1mnJgQdaES7aTCY7dhde_2V5frLvHv3TL9TyglPNW2P5epk4kcO3zX?purpose=fullsize)

**4–16 hráčů** běží šílenou překážkovou dráhu.

Cíl:

> **Dostaň se do cíle. Nezabij se. A ideálně neshod ostatní.**

---

# 🎮 Core gameplay

Každý match bych udělal jako **3–4 kola**.

Například:

```text
ROUND 1 — RACE
16 hráčů
↓
8 postupuje

ROUND 2 — RACE
8 hráčů
↓
4 postupují

ROUND 3 — SURVIVAL
4 hráči
↓
2 postupují

FINAL — RACE
2 hráči
↓
🏆 WINNER
```

Ale klidně můžeme mít i:

```text
🏃 Race
💀 Survival
🪙 Collect
👥 Team
🏁 Final Race
```

Takže nikdy přesně nevíš, co přijde.

---

# 🏃 1. Race

Tohle bude **hlavní mód**.

Trať je například 500 metrů.

A skládá se z různých segmentů.

```text
START
  │
  ▼
[Rotating Bars]
  │
  ▼
[Moving Platforms]
  │
  ▼
[Wind Tunnel]
  │
  ▼
[Jump Section]
  │
  ▼
[Rolling Balls]
  │
  ▼
[Final Climb]
  │
  ▼
FINISH 🏁
```

A nejlepší věc:

### Trať se generuje z modulů.

Nemusíme dělat 50 kompletních map.

Máme třeba:

**20 segmentů**

a z nich skládáme závody.

---

# 🧱 Segmentový systém

Například:

### Straight

```text
████████████████
```

### Gap

```text
██████    ██████
```

### Moving platforms

```text
████
       ████
             ████
```

### Rotating bar

```text
    ─────────
         │
         │
```

### Spinner

```text
       │
   ────●────
       │
```

### Pendulum

```text
     ●
      \
       \
        █
```

### Conveyor belt

```text
>>>>>>>>>>>>>>>>>
```

### Ice

```text
═════════════════
```

### Bounce pads

```text
⬆    ⬆    ⬆
```

### Falling tiles

```text
████████████
██  ██  ████
```

---

# 😈 Ale přidejme interakci mezi hráči

Tady se od Fall Guys můžeme trochu odlišit.

Hráči se **fyzicky ovlivňují**.

Například:

```text
      🔴
       ↓

👤 👤 👤 👤
   ↑
   │
  BUMP
   │
   💀
```

Jeden hráč může:

- strčit druhého
- skočit na něj
- narazit do něj
- vzít předmět
- hodit předmět
- použít dash

Ale nechceme, aby to bylo příliš „griefable“.

Proto bych udělal:

### Knockback ano.

### Přímé zabití ne.

Tvoje vlastní chyba tě zabije.

---

# 🪠 Grapple / grab

Tady bych byl opatrný s klasickým Fall Guys grabem.

Ale **grab systém** může být skvělý.

Například:

Pokud jsi těsně za hráčem:

**E → chytíš ho**

A držíš ho třeba:

**0.7 s**

Ale:

- nemůžeš běžet
- druhý hráč se může vytrhnout
- cooldown

Takže:

> „Drž ho! Drž ho!“

😂

---

# 💥 Power-ups

Na trati jsou boxy.

```text
❓
```

Náhodně dostaneš item.

### 🥊 Punch

Krátký silný knockback.

### 🪃 Boomerang

Trefí hráče před tebou.

### 🛡️ Shield

Krátká imunita.

### 🦘 Jump

Obrovský skok.

### 🚀 Rocket

Krátký burst dopředu.

### 🧲 Magnet

Přitáhne nejbližšího hráče.

### 🫧 Bubble

Na 3 sekundy tě odlepí od fyziky.

### 🐌 Slow

Zpomalí hráče před tebou.

---

# 🧠 Risk / reward

Tohle je podle mě hodně důležité.

Trať by neměla mít jednu optimální cestu.

Například:

```text
              ┌── EASY ──────────┐
START ────────┤                   ├── FINISH
              └── HARD ──────────┘
                    ↑
               shortcut
```

Easy:

**bezpečná cesta**

Hard:

**rychlá cesta, ale mnohem větší šance na pád.**

Například:

### Safe

+10 sekund

### Risk

−5 sekund

ale musíš:

- přeskočit tři platformy
- projet spinner
- skočit přes propast

Takže hráč může říct:

> „Seru na to, risknu to.“

---

# 🏁 Checkpointy

Aby pád neznamenal vždy začátek.

Trať rozdělíme:

```text
START
 │
 ▼
CHECKPOINT 1
 │
 ▼
CHECKPOINT 2
 │
 ▼
CHECKPOINT 3
 │
 ▼
FINISH
```

Spadneš:

→ respawn na posledním checkpointu.

Ale:

### respawn má 2 sekundy penalty.

Takže pořád bolí chyba.

---

# 🏆 Kvalifikace

Místo:

> „prvních 8“

bych udělal **časový limit**.

Například:

**2:30**

A kdo je v cíli → kvalifikuje se.

Kdo není → konec.

To vytváří skvělý chaos u konce.

---

# 🔥 FINISH musí být chaotický

Ne:

> doběhneš → konec.

Ale:

**FINISH ZONE**

```text
        🏁
   ┌──────────┐
   │ FINISH   │
   └──────────┘

👤 👤 👤 👤 👤
```

Prvních 8 se kvalifikuje.

A najednou:

> **„JEŠTĚ JEDEN! HONEM!“**

Někdo skočí.

Někdo ho strčí.

Někdo mine platformu.

😂

---

# 🗺️ Typy levelů

A tady bych udělal několik **témat**.

## 🌴 Tropical

![Image](https://images.openai.com/static-rsc-4/nsoAxy4EDAX_i0vcrnA1ySR8l-s-o-YAPPQmmLPmuxoEMJUvFkFA-DhnFoocEoVTT23cQu5t9RCTHvRkyrBK70cxFfnqFVKbyQTQrZbImv3vZjtBY2x-5swV01Iupfgv1VQuOegDhnj-PDBccv0OQqq9mPY1KcWW43Xv7qqr5WSeRdw_jFfxlZinhwfn5mqd?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/RBXS7unaxqHXO1KtQWG73aA8rlbKfd4DeIWsU9UNSsCBmEa2zTSm0g0u2Ovm3OKvlrUrJtFgupc5glnTSgB3Jg1x0CO_XgjHXY_oJE2aMIPsP0DVyKpVakiJqXNoY2zoBcVRduVBGyL5mQo_vmcnURGKk0KzONv1yXMd3pDeKf0w6Ka0QV5PsQUKuZy1J7lk?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/3ayqbGEGmqwRlAEuLSxwnur94FWpUf2jM2bPHsbe4uBKSEXecC7ZThJkJqac1xiDZDNQJc8mh5MFPGpBK6zpQb6aMsYbVf-qd_PWO7sbnMeLHbpOnGvXu55vgDhwxrDXOUjLF9FvOKrm0vRBTaIgQy3CKRq7ReZUAW9te5LmzN1runvO72TdGlVIOa_3-BEw?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/bw2d8M4bhUmFK2Uni8l7QdVsalis4fiZye-rxnaY7Ovg_wLDwm_UPSyNQhsvl15UqT6u6w8V0zj78ooun243no6llhenmdR0dJMsrNtxoLW-LZQ6aSu37YMbl9QsUCUFyNWn8mCi_hN3x0ofbEKsshNN_HBrf-UVhtKOlftPlu0CWoHUXfRpNpcI-pEHssO6?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/pa8X1p8oQxxbHWP2pPa9-LxB3hUmFMLkPUDC3kSPTCHQvSLmfdZQ_X8bVyYpbMXKehFjSWgwKANBAdcBL4v4BZ1544XYUVFA-Mw4SV9HpsBTClhSdJBc27JFqBk2eKHXaFhVyvNNsDP-8XFl6MYRMJfsuVhA8kGwOPeeAF1_JXGrAst_4jp4LVqPl3Txmlz7?purpose=fullsize)

- palmy
- voda
- mosty
- rotující klády
- kokosové bomby
- opice 😂

---

## 🏭 Factory

![Image](https://images.openai.com/static-rsc-4/MShIRxubNNKEdX4Oh9HKwWTBTaB7WyK7K4yeF1o5ahCPM8s6hDqmPdwLKySeO3tasoJp0HMw7gGSZDxI8-nT9b-CUrQASNBeWCVrkFrQlaKlKqQ3cmESvpenmo_kHdkS5fHtww45DYrzoepbh_AxtaEVDm3-HRE0pQSmoZT22dpwT53K0JYEfMAg9CV7LS-q?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/dNCzZ6YAjlakuuUrSj88ARcSpRxn9PjQV58g9G43aWLLbGGdpMKJ9Au5KnJh4jSL7qtB2nM0HpHpzYk9Qy-ipL5zHYnZDiyo5kk3Dau1rT1psneOA_tGF5tAa7qddJPbwm9tDqqIJHYW288dW5naSVgO9TD1Jv2Co1Hg-RlJTtzhRYmnMqlJeZwKCk1chmZ2?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/gI9ph1C0u42W4kFVLPZSXrWkVD7h4Py_NqvP5hbR7ylMs8g0CHilWe3R-A6-_HF26yY6BXe1odQ4zw7ZUZ2OYjyFsYKz1sDHGIBiWDRORJLrK_Ke1r7llqm3ekZ98bR-XYyPg3g5h7veSZl5-rrjl64mYSEzsXff1eTDPhV2xeUZjAJCwJ4iPrcFDvv54bZT?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/53lzxdEnsSZ9p9tdhZQMViNtzSNrjAo3IU_bmykju9yccN-V2iQuuS6mJy8oIeOpoB3oQCjSB2eo7rbU0UIvFmKxp5bNwCO4jcvleNoLoVAEjm4n5JnzAciYhrEA_S6b96EsMgVmj2Sdq-U6WBO2B5s1kKoi8RiLNBZXj5ZA5nA9JR8We6IPEyMpQl3eEm9e?purpose=fullsize)

- lisy
- pásy
- ventilátory
- láva
- válce
- hydraulické platformy

---

## ❄️ Arctic

![Image](https://images.openai.com/static-rsc-4/PikDWPp2ymGx8EjzgLHR7ZNICvl678ec1gbu-bmqpYDx3uXsvzGXWr8TxMvMN4Ubm37tPd1ekR_Vjwhu5NE2I4MIRSZnoPV1rb4RYf-T2uogBizMmhJrH1dShup1pnwfjtcyu__BTsGBJzK-aFLKYP4-U-_zrP7J_ZUV7ySVWBncvEPvotgZwdug-kSHcjoE?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/0vU2euU6xWpQt8cNMn0G1zDF2tQ5tAKCpxYduZ61f_xzkk3uO8uhxne3viy9Td4K1CjmPm_mygsHGwjot-PIlO98rZ8G3_LouUXp3m9Ky1u64cD4GoGtXebjm1iCQ2Yxc-J1CNN6Gc2GSAI2p9GCdB-jV_DYwhW7iJbhYj-cqFGKHBkjxY-Z6k5ejN1ivnjS?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/XSWmnXKZpFvp1nGgfyUjAKLX0HOGQpx4xh8QbpNp-CCxM0QdUt1Zqr_fCMKLbzSy2Q1OFB7ZKM0s5FTEzhCVZccuM3qqPUq0Y_N0KXczgyw6aOic0KWAhwdTBrfGB8rTBd7EzWPJzSj36y9srOvwjYdanuCw2pj2peUEnVfKjFXbTlxNzs-fAeFmJ7PlNskB?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/swj79RVqbTpO-sNCciafMmXqwP8LbznFvJe2fMEQu4FBtxnJDeKGAyXQ6fsXbZk7KVLcFX-hGw-WrOb7ehNo7EeYYnvGQMRYv0vKQjRWy4aIOPpRZ85Og0arkCgy51Qzrna7IZx3AITTcfgca3AdFQBMmonwXkYIbvytb5OMFZnSr3f_jYaulh3kXr_0a75t?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/w46LcLugAmOJPcvTcrYpGvkbb_edlFOam7mBTKWL1TB_WstZyb4XghoO-3Jo8XGiXSUBMsMfvoX3oCl8yR6D0r6Y65IjkP4iiFGVDn0LfIvj0-svdZX3EnECqbu6adnjUu7h_MjNTXqqnxCeDuTkhN_LJAEHZyBOj2iTeSjeMhvEeZhXWT8Ai7QwKuAf_3TQ?purpose=fullsize)

- led
- sníh
- laviny
- klouzání
- zamrzlé platformy

---

## 🌋 Volcano

![Image](https://images.openai.com/static-rsc-4/EEtaKGSDGCBMws9JfDn0GP6KW5rnPbc9XuufIKgegXhUllOlA038LG8yPKGYUhKUqQUcqETv-Ov7H0aBndIiTXkfCGOic4O4l1mVilIrgL7Fvj260sFaiaTzAsXmR5nYp12gNYmNmsu7YcLLEBoEGmo9FM16LP7bzQ8VZOUDlbSy2ojuJ1O6qoiHJEljzRHS?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/fWFF6CjFUAYLk80-QDr7AbSG-4TztW56Uodxxx-JKs4MtpMHJN5Qgb341xbmBOqX5eIknEYeN4tgkKqqJ-o64urjkzQc9-7OlTrdQJI_tNaEm-hkSsshJOiks2lyYMO9ubRq--2Ml7TQtysSZs-ISS8q1r_6EU9O20s1TjlpIo9O-Yr5Mwf3vh1tUz9DGW5p?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/sjFsbanOHTTB0QYDC1Zvdf2Xd5DD2Fccvfj_1DkOEs8U-8thDUoQTfMaFpLyKTPb6ld-OLsY9EokEAmUD4AnANWzECF7uFcK9EONgrcAPgh84sVzm7vORku1UWC3w2kH3JQML94I_SwSScXzOxBZjDWbDxrA6XXdQBDe0jibVbeq0KtEq96UXYLyxEJBX0-q?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/_ZNcBw-6fF9k788eIJaLGDUuscsEv_UfCFaDf9yiKsZO98gvDA0Uq7CiCqCtr4kiBVjXBnWHrAZEmAWtQW6yCKnzl35fPQRZO-F2enElfn5NyWrN7quP0qwSBzl23z4-Af4MbnZ9MPdLF7-8EHA_QWhcef3HMSfR1JHO7M-nG5UECjTORtkM3URw3IMa0ZxN?purpose=fullsize)

![Image](https://images.openai.com/static-rsc-4/TAQfYv4g7KKeLX0-JWU9WNu9a0QOZu2e4oMULxKmqW5fl_HQ8fGjn1gOtPYG35WKW0FnQdGDKqasjJppLtsi4hrKGZe9L43HkqQQwzXIcx39qe0Hf8C6OSrmXDh7W8aqYfqtqa1PB2PNXagFhoWNe_d9mxThtlpxKTiZ4wO883NZlWQBWsgdBrk2dr2wCgew?purpose=fullsize)

- láva
- meteory
- padající kameny
- explodující platformy

---

# 🧩 Procedurální tratě

A tady bych šel ještě dál.

**Nechci, aby mapa byla pokaždé stejná.**

Máme:

```text
START
 ↓
A
 ↓
B
 ↓
C
 ↓
D
 ↓
FINISH
```

Ale server náhodně vybere:

```text
A = Spinner
B = Ice
C = Moving Platforms
D = Wind
```

Další hra:

```text
A = Pendulum
B = Conveyor
C = Falling Tiles
D = Bounce Pads
```

Takže máme například:

**30 obstacle modules × 5 variant = stovky kombinací.**

---

# 👑 Finále

A finále bych udělal **speciální**.

Ne klasický survival.

### „The Skyfall“

Poslední 4 hráči.

Obrovská vertikální mapa.

Všichni musí **šplhat nahoru**.

```text
               🏁
                │
           █████████
              👤
         ███████████
             👤
       █████████████
          👤
    ███████████████
         👤
████████████████████
```

Platformy:

- rotují
- padají
- posouvají se
- mají trampolíny
- fouká vítr

A **kdo první dosáhne koruny → WIN.**

---

# 🧨 A jedna mechanika, kterou bych určitě přidal

## „DON'T FALL“

Když spadneš:

kamera se na chvíli přepne do **spectator mode**.

A můžeš sledovat ostatní.

Ale dostaneš možnost:

### 💰 BET

Tipni si, kdo vyhraje.

Například:

> **Who will win?**
>
> 🟢 Tomáš
> 🔵 Martin
> 🟡 Petr
> 🔴 Honza

Když trefíš:

**+XP / coins**

Tím se eliminovaní hráči pořád nějak baví.

---

# Celkově bych tedy hru definoval takhle

> **DON'T FALL** > _A chaotic multiplayer obstacle-racing game._

**8–16 players**

↓

**Race**

↓

**Physics chaos**

↓

**Qualify**

↓

**New race**

↓

**Survival / special event**

↓

**Final race**

↓

🏆 **WINNER**

A hlavní designová filozofie:

> **Easy to understand. Hard to master. Hilarious when you fail.**

A hlavně bych se **nesnažil kopírovat Fall Guys 1:1**. Fall Guys je dobrá reference pro strukturu zápasu, ale naše unikátní věc může být **silnější fyzika + interakce hráčů + procedurálně skládané tratě + absurdní eventy**.
