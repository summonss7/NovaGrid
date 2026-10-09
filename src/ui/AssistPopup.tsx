import { useEffect, useState, type RefObject } from 'react'
import type { AssistInfo, AssistSuggestion } from '../formula/assist'
import { useT } from '../i18n'

/*
 * Попап подсказок формул (Этап 4.4, Ф6): список функций по префиксу и
 * подпись аргументов вызова, в котором стоит каретка. Позиционируется по
 * rect якорного input; состояние держит хук useFormulaAssist.
 */

export function AssistPopup(props: {
  anchor: RefObject<HTMLInputElement | null>
  assist: AssistInfo
  activeIdx: number
  onPick: (suggestion: AssistSuggestion) => void
}) {
  const t = useT()
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)
  const { assist, activeIdx } = props

  useEffect(() => {
    const el = props.anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 340) })
  }, [props.anchor, assist, activeIdx])

  if (!rect) return null
  const hasSuggestions = assist.suggestions.length > 0
  if (!hasSuggestions && !assist.argHint) return null

  return (
    <div
      className="assist-popup"
      style={{ left: rect.left, top: rect.top, minWidth: rect.width }}
      role="listbox"
      aria-label={t.assistLabel}
    >
      {assist.argHint && (
        <div className="assist-args">
          <span className="assist-args-name">{assist.argHint.name}</span>(
          {assist.argHint.args.map((a, i) => (
            <span key={i} className={i === assist.argHint!.argIdx ? 'assist-arg-current' : undefined}>
              {a}
              {i < assist.argHint!.args.length - 1 ? '; ' : ''}
            </span>
          ))})
        </div>
      )}
      {hasSuggestions && (
        <ul className="assist-list">
          {assist.suggestions.map((s, i) => (
            <li
              key={s.name}
              role="option"
              aria-selected={i === activeIdx % assist.suggestions.length}
              className={i === activeIdx % assist.suggestions.length ? 'assist-item-active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => props.onPick(s)}
            >
              <span className="assist-item-name">{s.name}</span>
              <span className="assist-item-desc">{s.desc}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
