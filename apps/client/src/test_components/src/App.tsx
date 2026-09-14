import { useEffect, useState } from 'react';
import { SCREENS } from './screens';
import { FEELS } from './tokens';
import type { Feel } from './tokens';
import s from './App.module.css';

/** Dev harness: pick a screen, see it fluid at any width. Not part of the game shell. */
export default function App() {
  const [id, setId] = useState(() => localStorage.getItem('dontfall.screen') ?? '1a');
  const [feel, setFeel] = useState<Feel>(() => (localStorage.getItem('dontfall.feel') as Feel) ?? 'snappy');

  useEffect(() => { localStorage.setItem('dontfall.screen', id); }, [id]);
  useEffect(() => { localStorage.setItem('dontfall.feel', feel); }, [feel]);

  const current = SCREENS.find((x) => x.id === id) ?? SCREENS[0];
  const Screen = current.Comp;

  return (
    <div className={s.app}>
      <nav className={s.rail}>
        <div className={s.brand}>
          <span className={s.brandName}>DON’T FALL</span>
          <span className={s.brandMeta}>UI SHELL · {SCREENS.length} SCREENS</span>
        </div>

        <div className={s.list}>
          {SCREENS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setId(x.id)}
              className={[s.item, x.id === id && s.active].filter(Boolean).join(' ')}
            >
              <span className={s.itemId}>{x.id}</span>
              <span>{x.name}</span>
              {!x.built && <span className={s.todo}>TODO</span>}
            </button>
          ))}
        </div>

        <div className={s.group}>
          <span className={s.groupLabel}>PRESS FEEL</span>
          <div className={s.segmented}>
            {FEELS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFeel(f)}
                className={[s.seg, feel === f && s.segOn].filter(Boolean).join(' ')}
              >{f.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </nav>

      <main className={s.viewport}>
        <div className={s.frame}>
          <Screen feel={feel} />
        </div>
      </main>
    </div>
  );
}
