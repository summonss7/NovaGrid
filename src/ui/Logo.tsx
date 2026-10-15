/**
 * Фирменный знак «ячейка с продолжением линий» (docs/DESIGN-SYSTEM.md §5,
 * пожелание владельца novagrid-029): зелёная ячейка в центре чёрной плитки,
 * оранжевые жирные лучи продолжают её рёбра наружу — ячейка не одна, из них
 * складывается целая таблица. Жирные штрихи — знак читается в иконках 16 px.
 */

interface LogoMarkProps {
  size?: number
  title?: string
}

/** Только знак (используется в тулбаре и как favicon). */
export function LogoMark({ size = 30, title }: LogoMarkProps) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={title ?? 'NovaGrid'}
    >
      {/* чёрная плитка — фон знака в обеих темах */}
      <rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="#000000" />
      {/* оранжевые продолжения рёбер ячейки — таблица продолжается за кадром */}
      <g stroke="var(--nv-accent)" strokeWidth="6" strokeLinecap="round">
        <line x1="6" y1="24" x2="42" y2="24" />
        <line x1="24" y1="6" x2="24" y2="42" />
      </g>
      {/* зелёная ячейка — центр знака */}
      <rect x="15" y="15" width="18" height="18" rx="3.5" fill="var(--nv-primary)" />
    </svg>
  )
}

/** Знак + слово NovaGrid: «Nova» чернильным, «Grid» фирменным зелёным (§5). */
export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-word">
        Nova<span className="logo-word-grid">Grid</span>
      </span>
    </span>
  )
}
