import { ChevronDown, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { useT } from '../i18n'
import { useMenuKeys } from './menuKeys'

/*
 * Диалог «Найти и заменить» (Этап 7, CONCEPT §6 в.5): Ctrl+H, кнопка в
 * панели поиска, пункт в мобильном «⋯». Найти/заменить, область «лист /
 * все листы», регистр, «ячейка целиком», «искать в формулах» (замена
 * значения ↔ текста формулы). Живой счётчик «Найдено: N», после действия —
 * «Заменено: N». Модальный, как остальные диалоги: фокус-трап, Esc, ARIA.
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

export function ReplaceDialog(props: { onClose: () => void }) {
  const t = useT()
  const r = useStore(gridStore, (s) => s.replace)
  const ref = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  useMenuKeys(ref, props.onClose, { itemSelector: null, autoFocusSelector: '.replace-find' })

  useEffect(() => {
    findRef.current?.select()
  }, [])

  // фокус-трап: Tab не уходит из диалога, пока он открыт
  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null
    const inside = active !== null && ref.current.contains(active)
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault()
        last.focus()
      }
    } else if (!inside || active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const found = r.query === '' ? '' : r.lastCount !== null ? t.replaceDone(r.lastCount) : t.replaceFound(r.hits.length)
  const noHits = r.hits.length === 0

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.currentTarget === e.target) props.onClose()
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.replaceTitle}
        onKeyDown={trapFocus}
      >
        <div className="replace-head">
          <h2 className="dialog-title">{t.replaceTitle}</h2>
          <span className="replace-counter" aria-live="polite">
            {found}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={t.replaceClose}
            onClick={props.onClose}
          >
            <X size={16} strokeWidth={1.7} aria-hidden />
          </button>
        </div>

        <label className="dialog-field">
          <span className="dialog-label">{t.replaceFindLabel}</span>
          <input
            ref={findRef}
            className="dialog-input replace-find"
            type="search"
            value={r.query}
            spellCheck={false}
            onChange={(e) => gridStore.getState().setReplaceQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                gridStore.getState().replaceStep(e.shiftKey ? -1 : 1)
                e.preventDefault()
              }
            }}
          />
        </label>

        <label className="dialog-field">
          <span className="dialog-label">{t.replaceWithLabel}</span>
          <input
            className="dialog-input"
            type="text"
            value={r.replacement}
            spellCheck={false}
            onChange={(e) => gridStore.getState().setReplaceField({ replacement: e.target.value })}
            onKeyDown={(e) => {
              // Enter в любом поле — шаг к следующему совпадению (как в Excel)
              if (e.key === 'Enter') {
                gridStore.getState().replaceStep(e.shiftKey ? -1 : 1)
                e.preventDefault()
              }
            }}
          />
        </label>

        <div className="replace-scope-row">
          <div className="search-scope" role="radiogroup" aria-label={t.searchScopeLabel}>
            <button
              type="button"
              role="radio"
              aria-checked={r.scope === 'sheet'}
              className={r.scope === 'sheet' ? 'search-scope-btn is-active' : 'search-scope-btn'}
              onClick={() => gridStore.getState().setReplaceField({ scope: 'sheet' })}
            >
              {t.searchScopeSheet}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={r.scope === 'book'}
              className={r.scope === 'book' ? 'search-scope-btn is-active' : 'search-scope-btn'}
              onClick={() => gridStore.getState().setReplaceField({ scope: 'book' })}
            >
              {t.searchScopeBook}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-xs"
            aria-label={t.searchNext}
            title={t.searchNext}
            disabled={noHits}
            onClick={() => gridStore.getState().replaceStep(1)}
          >
            <ChevronDown size={15} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        <div className="replace-checks">
          <label>
            <input
              type="checkbox"
              checked={r.caseSensitive}
              onChange={(e) =>
                gridStore.getState().setReplaceField({ caseSensitive: e.target.checked })
              }
            />
            {t.searchCaseSensitive}
          </label>
          <label>
            <input
              type="checkbox"
              checked={r.wholeCell}
              onChange={(e) => gridStore.getState().setReplaceField({ wholeCell: e.target.checked })}
            />
            {t.searchWholeCell}
          </label>
          <label>
            <input
              type="checkbox"
              checked={r.inFormulas}
              onChange={(e) =>
                gridStore.getState().setReplaceField({ inFormulas: e.target.checked })
              }
            />
            {t.replaceInFormulas}
          </label>
          <p className="replace-note">{t.replaceFormulasNote}</p>
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={noHits}
            onClick={() => gridStore.getState().replaceCurrent()}
          >
            {t.replaceAction}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={r.query === ''}
            onClick={() => gridStore.getState().replaceAll()}
          >
            {t.replaceAllAction}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Точка входа «Найти и заменить»: Ctrl+H открывает диалог из любого места
 * книги (как Ctrl+F у поиска); сам диалог рендерится, пока open в сторе.
 * Пока диалог открыт, Ctrl+Z/Ctrl+Y работают и из него (фокус после
 * «Заменить все» остаётся на кнопке) — один Ctrl+Z откатывает батч;
 * в текстовых полях остаётся нативный undo ввода, как в Excel.
 */
export function ReplaceHost() {
  const open = useStore(gridStore, (s) => s.replace.open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.code === 'KeyH') {
        e.preventDefault()
        gridStore.getState().openReplace()
      } else if (e.key === 'Escape' && gridStore.getState().replace.open) {
        gridStore.getState().closeReplace()
      } else if (
        mod &&
        gridStore.getState().replace.open &&
        (e.code === 'KeyZ' || e.code === 'KeyY')
      ) {
        const inTextInput = document.activeElement?.tagName === 'INPUT'
        if (inTextInput) return
        e.preventDefault()
        const st = gridStore.getState()
        if (e.code === 'KeyY' || e.shiftKey) st.redo()
        else st.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return open ? <ReplaceDialog onClose={() => gridStore.getState().closeReplace()} /> : null
}
