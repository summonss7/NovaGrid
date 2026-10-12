import { FolderOpen, HelpCircle, Search, Sigma } from 'lucide-react'
import { useState } from 'react'
import { gridStore } from '../core/store'
import { useT } from '../i18n'
import { HelpDialog } from './HelpDialog'

/**
 * Нижняя панель действий мобильной раскладки (DESIGN-SYSTEM §9, Этап 5.2):
 * Открыть · Поиск · Σ · ? — крупные касания ≥ 48 px. На десктопе скрыта CSS
 * (медиа-выражение pointer: coarse / узкий экран). Σ — автосумма
 * (novagrid-020, как в тулбаре): стоя на ячейке, выбрать ячейки касанием —
 * в неё вставится =СУММ; повторное касание Σ отменяет выбор. Живые метрики
 * Σ/n/x̄ остаются в статус-баре, полная карточка — шеврон Σ в тулбаре.
 */
export function MobileBar(props: { onOpen: () => void }) {
  const t = useT()
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
        aria-label={t.sumAutosum}
        title={t.sumAutosumTitle}
        onClick={() => {
          const st = gridStore.getState()
          if (st.sumPick) st.cancelSumPick()
          else st.startSumPick()
        }}
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

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </nav>
  )
}
