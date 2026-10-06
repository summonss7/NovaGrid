/**
 * Фирменный знак «N» из двух стрелок (docs/DESIGN-SYSTEM.md §5):
 * зелёная стрелка вниз-влево, оранжевая вверх-вправо, внутри — намёк на сетку
 * ячеек. Смысл: таблица и рост. Отрисован по дизайн-макету
 * Gemini_Generated_Image_iw52kuiw52kuiw52.jpg.
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
      {/* белая плитка-ячейка, чтобы сетка читалась и на поверхности тулбара */}
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="11"
        fill="var(--nv-bg)"
        stroke="var(--nv-grid-line)"
      />
      {/* намёк на сетку ячеек 2×2 */}
      <g stroke="var(--nv-grid-line)" strokeWidth="1.5" strokeLinecap="round">
        <line x1="24" y1="5" x2="24" y2="43" />
        <line x1="5" y1="24" x2="43" y2="24" />
      </g>
      {/* вертикальные штрихи литеры N */}
      <rect x="9" y="8" width="6.5" height="32" rx="3.25" fill="var(--nv-ink)" />
      <rect x="32.5" y="8" width="6.5" height="32" rx="3.25" fill="var(--nv-ink)" />
      {/* зелёная стрелка — вниз-влево */}
      <g>
        <line
          x1="34.5"
          y1="10"
          x2="22.5"
          y2="22"
          stroke="var(--nv-primary)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <polygon points="16,29 24.91,26.59 18.41,20.09" fill="var(--nv-primary)" />
      </g>
      {/* оранжевая стрелка — вверх-вправо */}
      <g>
        <line
          x1="13.5"
          y1="38"
          x2="25.5"
          y2="26"
          stroke="var(--nv-accent)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <polygon points="32,19 29.59,27.91 23.09,21.41" fill="var(--nv-accent)" />
      </g>
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
