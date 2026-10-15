/**
 * Фирменный знак «сфотографированная ячейка» (docs/DESIGN-SYSTEM.md §5,
 * пожелание владельца novagrid-031): кадр вырезал из таблицы одну ячейку —
 * зелёный контур выделения, а из углов кадра торчат оранжевые обломки линий
 * соседних ячеек. Линии сетки идут по координатам рёбер ячейки, чёрная
 * заливка рамки прикрывает их середины. Жирные штрихи — знак читается
 * в иконках 16 px.
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
      {/* оранжевая сетка по рёбрам ячейки — за рамкой видны обломки линий
          соседних ячеек, попавшие в «кадр» */}
      <g stroke="var(--nv-accent)" strokeWidth="6" strokeLinecap="round">
        <line x1="6" y1="12.3" x2="42" y2="12.3" />
        <line x1="6" y1="35.7" x2="42" y2="35.7" />
        <line x1="12.3" y1="6" x2="12.3" y2="42" />
        <line x1="35.7" y1="6" x2="35.7" y2="42" />
      </g>
      {/* зелёная ячейка — контур выделения; чёрная заливка = «пустая»
          (заодно прикрывает середины линий сетки) */}
      <rect
        x="12.3"
        y="12.3"
        width="23.4"
        height="23.4"
        rx="3.5"
        fill="#000000"
        stroke="var(--nv-primary)"
        strokeWidth="6"
      />
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
