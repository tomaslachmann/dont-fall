import css from './SegmentedControl.module.css';

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
  /** dimmed counter after the label */
  count?: number;
  title?: string;
}

interface Props<T extends string> {
  items: SegmentedItem<T>[];
  value: T;
  onChange?: (value: T) => void;
  /** pill = fully round trough, plate = rounded-rect trough */
  shape?: 'pill' | 'plate';
  /** brand = purple active chip, ink = dark active chip, plastic = white raised chip */
  tone?: 'brand' | 'ink' | 'plastic';
  size?: 'sm' | 'md';
  /** stack the count under the label — for counted tabs in narrow columns */
  layout?: 'row' | 'stack';
}

export function SegmentedControl<T extends string>({
  items, value, onChange, shape = 'plate', tone = 'brand', size = 'md', layout = 'row',
}: Props<T>) {
  return (
    <div className={[css.root, css[shape], size === 'sm' ? css.sm : undefined, layout === 'stack' ? css.stack : undefined].filter(Boolean).join(' ')} role="tablist">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button key={it.value} type="button" role="tab" aria-selected={active} title={it.title}
            className={[css.item, active ? css['on_' + tone] : ''].join(' ')}
            onClick={() => onChange?.(it.value)}>
            {it.label}
            {it.count != null && <span className={css.count}>{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
