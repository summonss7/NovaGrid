import { FileDown, FolderOpen, HelpCircle, Save } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { normalize } from '../core/selection'
import { gridStore, rangeMetrics } from '../core/store'
import { ru } from '../i18n/ru'
import { Logo } from './Logo'
import { SearchBox } from './SearchBox'
import { SumCard } from './SumCard'

/**
 * Тулбар (DESIGN-SYSTEM §6): лого · Открыть · Сохранить · Сохранить как… ·
 * имя файла с точкой несохранённых правок · поиск · справка · Σ справа.
 * Этап 3 оживляет поиск (Ф2) и кнопку Σ: клик — карточка метрик, Alt-лассо —
 * живая сумма крупно в зоне Σ (Ф4). Справка — Этап 4.
 */
export function Toolbar(props: { onOpen: () => void; onSave: () => void; onSaveAs: () => void }) {
  const fileName = useStore(gridStore, (s) => s.fileName)
  const dirty = useStore(gridStore, (s) => s.dirty)
  const [sumOpen, setSumOpen] = useState(false)

  // Alt-лассо: сумма крупно в зоне кнопки Σ, пока тянется рамка (Ф4)
  const altSum = useStore(gridStore, (s) =>
    s.altRange
      ? rangeMetrics(s.sheet, normalize(s.altRange), visibleRowsOf(s.sheet, s.filters)).total
      : null,
  )

  return (
    <header className="toolbar">
      <Logo />

      <div className="toolbar-group" role="group" aria-label="Файл">
        <button type="button" className="btn btn-primary" onClick={props.onOpen}>
          <FolderOpen size={16} strokeWidth={1.5} aria-hidden />
          {ru.open}
        </button>
        <button type="button" className="btn btn-primary" onClick={props.onSave}>
          <Save size={16} strokeWidth={1.5} aria-hidden />
          {ru.save}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={props.onSaveAs}
          title="Ctrl+Shift+S"
        >
          <FileDown size={16} strokeWidth={1.5} aria-hidden />
          {ru.saveAs}
        </button>
      </div>

      {(fileName || dirty) && (
        <span className="file-badge" title={dirty ? ru.dirtyTitle : undefined}>
          {dirty && (
            <span className="file-dirty" aria-label={ru.dirtyTitle}>
              {ru.dirtyMark}
            </span>
          )}
          <span className="file-name">{fileName ?? ru.unsavedBook}</span>
        </span>
      )}

      <span className="toolbar-sep" aria-hidden />

      <SearchBox />

      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={ru.helpLabel}
        title={ru.helpLabel}
      >
        <HelpCircle size={18} strokeWidth={1.5} aria-hidden />
      </button>

      <span className="toolbar-spacer" aria-hidden />

      <span className="sum-zone">
        {altSum !== null && (
          <span className="sum-live" aria-live="polite">
            <span className="sum-live-caption" aria-hidden>
              {ru.sumLiveLabel}
            </span>
            <span className="sum-live-value">Σ {altSum.toLocaleString('ru-RU')}</span>
          </span>
        )}
        <button
          type="button"
          className="sum-btn"
          aria-label={ru.sumTitle}
          aria-expanded={sumOpen}
          title={ru.sumTitle}
          onClick={() => setSumOpen((v) => !v)}
        >
          <span className="sum-symbol" aria-hidden>
            Σ
          </span>
          <span className="sum-caption" aria-hidden>
            {ru.sumLabel}
          </span>
        </button>
        {sumOpen && <SumCard onClose={() => setSumOpen(false)} />}
      </span>
    </header>
  )
}
