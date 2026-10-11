import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { Printer } from 'lucide-react'
import { visibleRowsOf } from '../core/filter'
import { printStore, type PrintOptions } from '../core/print'
import { gridStore } from '../core/store'
import { useT } from '../i18n'

/**
 * Диалог настроек печати (Этап 7.4): что печатать (видимые строки по
 * фильтрам — по умолчанию, или весь лист), ориентация (альбомная по
 * умолчанию) и формат бумаги. «Печать…» применяет опции и вызывает
 * window.print() — печатный DOM в этот момент собирает ui/PrintView
 * (beforeprint), UI приложения скрывает @media print.
 */
export function PrintDialog(props: { onClose: () => void }) {
  const t = useT()
  const sheet = useStore(gridStore, (s) => s.sheet)
  const filters = useStore(gridStore, (s) => s.filters)
  const [draft, setDraft] = useState<PrintOptions>(printStore.getState().options)

  const total = Math.max(sheet.maxRow + 1, 0)
  const visible = visibleRowsOf(sheet, filters)
  const shown = visible ? visible.length : total

  const confirm = () => {
    printStore.getState().applyOptions(draft)
    props.onClose()
    window.print()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        props.onClose()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.currentTarget === e.target) props.onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t.printTitle}>
        <h2 className="dialog-title">{t.printTitle}</h2>

        <fieldset className="dialog-field print-what">
          <span className="dialog-label">{t.printWhatLabel}</span>
          <label className="print-choice">
            <input
              type="radio"
              name="nv-print-scope"
              checked={draft.scope === 'visible'}
              onChange={() => setDraft({ ...draft, scope: 'visible' })}
            />
            {t.printScopeVisible(shown, total)}
          </label>
          <label className="print-choice">
            <input
              type="radio"
              name="nv-print-scope"
              checked={draft.scope === 'all'}
              onChange={() => setDraft({ ...draft, scope: 'all' })}
            />
            {t.printScopeAll(total)}
          </label>
        </fieldset>

        <div className="dialog-row">
          <label className="dialog-field">
            <span className="dialog-label">{t.printOrientationLabel}</span>
            <select
              className="dialog-select"
              value={draft.orientation}
              onChange={(e) =>
                setDraft({ ...draft, orientation: e.target.value as PrintOptions['orientation'] })
              }
            >
              <option value="landscape">{t.printLandscape}</option>
              <option value="portrait">{t.printPortrait}</option>
            </select>
          </label>
          <label className="dialog-field">
            <span className="dialog-label">{t.printPaperLabel}</span>
            <select
              className="dialog-select"
              value={draft.paper}
              onChange={(e) => setDraft({ ...draft, paper: e.target.value as PrintOptions['paper'] })}
            >
              <option value="a4">{t.printA4}</option>
              <option value="letter">{t.printLetter}</option>
            </select>
          </label>
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onClose}>
            {t.cancelAction}
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            <Printer size={16} strokeWidth={1.5} aria-hidden />
            {t.printAction}
          </button>
        </div>
      </div>
    </div>
  )
}
