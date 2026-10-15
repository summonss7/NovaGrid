import {
  ChevronDown,
  FileDown,
  FolderOpen,
  HelpCircle,
  MoreVertical,
  Printer,
  Replace,
  Save,
  Settings,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { printStore } from '../core/print'
import { normalize } from '../core/selection'
import { gridStore, rangeMetrics } from '../core/store'
import { useT } from '../i18n'
import type { OpeningRow } from '../storage/recents'
import { HelpDialog } from './HelpDialog'
import { Logo } from './Logo'
import { OpenMenu } from './OpenMenu'
import { SearchBox } from './SearchBox'
import { SettingsDialog } from './SettingsDialog'
import { SumCard } from './SumCard'

/**
 * Тулбар (DESIGN-SYSTEM §6): лого · Открыть · Сохранить · Сохранить как… ·
 * имя файла с точкой несохранённых правок · поиск · справка · Σ справа.
 * Этап 3 оживляет поиск (Ф2) и кнопку Σ: клик — карточка метрик, Alt-лассо —
 * живая сумма крупно в зоне Σ (Ф4). Справка — Этап 4.
 * Этап 5.2: на мобильном файловые кнопки уходят в меню «⋯» (нижняя панель
 * берёт Открыть/Поиск/Σ/?), тулбар остаётся тонкой строкой с именем файла.
 * novagrid-030: «Открыть» раскрывает меню — пикер + недавние файлы (как в
 * настольных офисах), а не сразу пикер.
 */
export function Toolbar(props: {
  onOpen: () => void
  onOpenRecent: (row: OpeningRow) => void
  onSave: () => void
  onSaveAs: () => void
}) {
  const t = useT()
  const fileName = useStore(gridStore, (s) => s.fileName)
  const dirty = useStore(gridStore, (s) => s.dirty)
  const [sumOpen, setSumOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState(false)

  // F1 открывает справочник — как в настольных офисных приложениях
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        setHelpOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Alt-лассо: сумма крупно в зоне кнопки Σ, пока тянется рамка (Ф4)
  const altSum = useStore(gridStore, (s) =>
    s.altRange
      ? rangeMetrics(s.sheet, normalize(s.altRange), visibleRowsOf(s.sheet, s.filters)).total
      : null,
  )

  return (
    <header className="toolbar">
      <Logo />

      <div className="toolbar-group" role="group" aria-label={t.fileGroupLabel}>
        {/* novagrid-030: «Открыть» показывает меню — пикер «Открыть файл…»
            плюс ссылки на последние открытые файлы (раньше недавние были
            доступны только на стартовом экране) */}
        <div className="toolbar-open">
          <button
            type="button"
            className="btn btn-primary"
            aria-haspopup="menu"
            aria-expanded={openMenu}
            onClick={() => setOpenMenu((v) => !v)}
          >
            <FolderOpen size={16} strokeWidth={1.5} aria-hidden />
            {t.open}
          </button>
          {openMenu && (
            <OpenMenu
              onBrowse={props.onOpen}
              onOpenRecent={props.onOpenRecent}
              onClose={() => setOpenMenu(false)}
            />
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={props.onSave}>
          <Save size={16} strokeWidth={1.5} aria-hidden />
          {t.save}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={props.onSaveAs}
          title="Ctrl+Shift+S"
        >
          <FileDown size={16} strokeWidth={1.5} aria-hidden />
          {t.saveAs}
        </button>
      </div>

      {/* мобильное меню «⋯» (5.2): файловые действия, не влезающие в тонкую строку */}
      <div className="toolbar-more">
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t.moreMenuLabel}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <MoreVertical size={20} strokeWidth={1.5} aria-hidden />
        </button>
        {moreOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMoreOpen(false)} aria-hidden />
            <div className="tab-menu toolbar-more-menu" role="menu">
              <button
                type="button"
                className="tab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  props.onSave()
                }}
              >
                <Save size={15} strokeWidth={1.5} aria-hidden />
                {t.save}
              </button>
              <button
                type="button"
                className="tab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  props.onSaveAs()
                }}
              >
                <FileDown size={15} strokeWidth={1.5} aria-hidden />
                {t.saveAs}
              </button>
              {/* Этап 7.4: печать на мобильном — из «⋯» (на десктопе Ctrl+P) */}
              <button
                type="button"
                className="tab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  printStore.getState().openDialog()
                }}
              >
                <Printer size={15} strokeWidth={1.5} aria-hidden />
                {t.printOpenAction}
              </button>
              <button
                type="button"
                className="tab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  setSettingsOpen(true)
                }}
              >
                <Settings size={15} strokeWidth={1.5} aria-hidden />
                {t.settingsLabel}
              </button>
              {/* Этап 7: «Найти и заменить» на мобильном — из «⋯» */}
              <button
                type="button"
                className="tab-menu-item"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  gridStore.getState().openReplace()
                }}
              >
                <Replace size={15} strokeWidth={1.5} aria-hidden />
                {t.replaceOpenAction}
              </button>
            </div>
          </>
        )}
      </div>

      {(fileName || dirty) && (
        <span className="file-badge" title={dirty ? t.dirtyTitle : undefined}>
          {dirty && (
            <span className="file-dirty" aria-label={t.dirtyTitle}>
              {t.dirtyMark}
            </span>
          )}
          <span className="file-name">{fileName ?? t.unsavedBook}</span>
        </span>
      )}

      <span className="toolbar-sep" aria-hidden />

      <SearchBox />

      <button
        type="button"
        className="btn btn-ghost btn-icon toolbar-help"
        aria-label={t.helpLabel}
        title={`${t.helpLabel} (F1)`}
        aria-expanded={helpOpen}
        onClick={() => setHelpOpen(true)}
      >
        <HelpCircle size={18} strokeWidth={1.5} aria-hidden />
      </button>

      <button
        type="button"
        className="btn btn-ghost btn-icon toolbar-settings"
        aria-label={t.settingsLabel}
        title={t.settingsLabel}
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen(true)}
      >
        <Settings size={18} strokeWidth={1.5} aria-hidden />
      </button>

      <span className="toolbar-spacer" aria-hidden />

      <span className="sum-zone">
        {altSum !== null && (
          <span className="sum-live" aria-live="polite">
            <span className="sum-live-caption" aria-hidden>
              {t.sumLiveLabel}
            </span>
            <span className="sum-live-value">Σ {t.num(altSum)}</span>
          </span>
        )}
        {/* Σ — автосумма (novagrid-020): ячейка-приёмник уже выбрана, после
            нажатия пользователь выделяет ячейки — в неё вставится =СУММ */}
        <button
          type="button"
          className="sum-btn toolbar-sum"
          aria-label={t.sumAutosum}
          title={t.sumAutosumTitle}
          onClick={() => {
            gridStore.getState().startSumPick()
            document.querySelector<HTMLElement>('.grid-area')?.focus({ preventScroll: true })
          }}
        >
          <span className="sum-symbol" aria-hidden>
            Σ
          </span>
          <span className="sum-caption" aria-hidden>
            {t.sumLabel}
          </span>
        </button>
        {/* шеврон у Σ — карточка метрик выделения (Ф4, как раньше по клику Σ) */}
        <button
          type="button"
          className="btn btn-ghost btn-icon toolbar-sum-metrics"
          aria-label={t.sumTitle}
          title={t.sumTitle}
          aria-expanded={sumOpen}
          onClick={() => setSumOpen((v) => !v)}
        >
          <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
        </button>
        {sumOpen && <SumCard onClose={() => setSumOpen(false)} />}
      </span>

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </header>
  )
}
