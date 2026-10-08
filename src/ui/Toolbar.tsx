import { FileDown, FolderOpen, HelpCircle, Save, Search } from 'lucide-react'
import { useStore } from 'zustand'
import { gridStore } from '../core/store'
import { ru } from '../i18n/ru'
import { Logo } from './Logo'

/**
 * Тулбар (DESIGN-SYSTEM §6): лого · Открыть · Сохранить · Сохранить как… ·
 * имя файла с точкой несохранённых правок · поиск · справка · Σ справа.
 * Поиск и справка оживают на этапах 3–4.
 */
export function Toolbar(props: { onOpen: () => void; onSave: () => void; onSaveAs: () => void }) {
  const fileName = useStore(gridStore, (s) => s.fileName)
  const dirty = useStore(gridStore, (s) => s.dirty)

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

      <div className="search">
        <Search size={15} strokeWidth={1.5} aria-hidden />
        <input
          type="search"
          className="search-input"
          placeholder={ru.searchPlaceholder}
          aria-label={ru.searchLabel}
        />
        <kbd className="search-kbd">{ru.searchHint}</kbd>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={ru.helpLabel}
        title={ru.helpLabel}
      >
        <HelpCircle size={18} strokeWidth={1.5} aria-hidden />
      </button>

      <span className="toolbar-spacer" aria-hidden />

      <button type="button" className="sum-btn" aria-label={ru.sumTitle} title={ru.sumTitle}>
        <span className="sum-symbol" aria-hidden>
          Σ
        </span>
        <span className="sum-caption" aria-hidden>
          {ru.sumLabel}
        </span>
      </button>
    </header>
  )
}
