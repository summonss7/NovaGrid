import { FolderOpen, HelpCircle, Save, Search } from 'lucide-react'
import { ru } from '../i18n/ru'
import { Logo } from './Logo'

/**
 * Тулбар (DESIGN-SYSTEM §6): лого · Открыть · Сохранить · поиск · справка ·
 * справа всегда на виду большая кнопка Σ. Действия появятся на Этапах 2–3 —
 * сейчас это каркас: кнопки стоят на своих местах, обработчиков нет.
 */
export function Toolbar() {
  return (
    <header className="toolbar">
      <Logo />

      <div className="toolbar-group" role="group" aria-label="Файл">
        <button type="button" className="btn btn-primary">
          <FolderOpen size={16} strokeWidth={1.5} aria-hidden />
          {ru.open}
        </button>
        <button type="button" className="btn btn-primary">
          <Save size={16} strokeWidth={1.5} aria-hidden />
          {ru.save}
        </button>
      </div>

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
