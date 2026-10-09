import { FolderOpen, HelpCircle, Search, Sigma } from 'lucide-react'
import { useState } from 'react'
import { gridStore } from '../core/store'
import { useT } from '../i18n'
import { HelpDialog } from './HelpDialog'
import { SumCard } from './SumCard'

/**
 * Нижняя панель действий мобильной раскладки (DESIGN-SYSTEM §9, Этап 5.2):
 * Открыть · Поиск · Σ · ? — крупные касания ≥ 48 px. На десктопе скрыта CSS
 * (медиа-выражение pointer: coarse / узкий экран). Карточка метрик Σ на
 * мобильном раскрывается плашкой над панелью, поиск открывается в тулбаре
 * тем же действием стора, что и Ctrl+F.
 */
export function MobileBar(props: { onOpen: () => void }) {
  const t = useT()
  const [sumOpen, setSumOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <nav className="mobile-bar" aria-label={t.mobileBarLabel}>
      <button type="button" className="mobile-bar-btn" onClick={props.onOpen}>
        <FolderOpen size={22} strokeWidth={1.5} aria-hidden />
        <span>{t.mobileOpen}</span>
      </button>
      <button
        type="button"
        className="mobile-bar-btn"
        onClick={() => gridStore.getState().openSearch()}
      >
        <Search size={22} strokeWidth={1.5} aria-hidden />
        <span>{t.mobileSearch}</span>
      </button>
      <button
        type="button"
        className="mobile-bar-btn mobile-bar-sum"
        aria-label={t.sumTitle}
        aria-expanded={sumOpen}
        onClick={() => setSumOpen((v) => !v)}
      >
        <Sigma size={22} strokeWidth={2} aria-hidden />
        <span>{t.mobileSum}</span>
      </button>
      <button
        type="button"
        className="mobile-bar-btn"
        aria-label={t.helpLabel}
        aria-expanded={helpOpen}
        onClick={() => setHelpOpen(true)}
      >
        <HelpCircle size={22} strokeWidth={1.5} aria-hidden />
        <span>{t.mobileHelp}</span>
      </button>

      {sumOpen && <SumCard onClose={() => setSumOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </nav>
  )
}
