import { Copy, PenLine, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { gridStore } from '../core/store'
import { useSettings, useT } from '../i18n'

interface TabMenu {
  x: number
  y: number
  index: number
}

/** Панель листов (§6 + Этап 2.2): вкладки — переключение, переименование
 *  (двойной клик), дублирование и удаление (меню ПКМ), добавление (+). */
export function SheetsBar() {
  const t = useT()
  const tabs = useStore(gridStore, (s) => s.tabs)
  const activeTab = useStore(gridStore, (s) => s.activeTab)
  const sheet = useStore(gridStore, (s) => s.sheet)
  const filters = useStore(gridStore, (s) => s.filters)
  const [menu, setMenu] = useState<TabMenu | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // «Вид» → вкладки рядами (novagrid-055): книги с десятками листов — все
  // вкладки в зоне видимости по ширине окна, без дальнего скролла
  const multi = useSettings((s) => s.tabsLayout === 'multi')

  useEffect(() => {
    if (editing !== null) inputRef.current?.select()
  }, [editing])

  const closeMenu = () => setMenu(null)

  const removeTab = (index: number) => {
    const tab = tabs[index]
    const hasContent = tab.sheet.cells.size > 0
    if (hasContent && !window.confirm(t.tabDeleteConfirm(tab.name))) return
    gridStore.getState().removeTab(index)
  }

  const commitRename = () => {
    if (editing === null) return
    const value = inputRef.current?.value ?? ''
    if (value.trim() !== '') gridStore.getState().renameTab(editing, value)
    setEditing(null)
  }

  return (
    <div className={`sheets-bar${multi ? ' sheets-bar-multi' : ''}`}>
      <div className="sheets-tabs" role="tablist" aria-label={t.sheetsTabsLabel}>
        {tabs.map((tab, i) => (
          <div key={tab.id} className="sheet-tab-wrap">
            {editing === i ? (
              <input
                ref={inputRef}
                className="sheet-tab-rename"
                defaultValue={tab.name}
                aria-label={t.tabRename}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') setEditing(null)
                  e.stopPropagation()
                }}
                spellCheck={false}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={i === activeTab}
                className={`sheet-tab${i === activeTab ? ' sheet-tab-active' : ''}`}
                onClick={() => gridStore.getState().activateTab(i)}
                onDoubleClick={() => setEditing(i)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  const bar = (
                    e.currentTarget.closest('.sheets-bar') as HTMLElement
                  ).getBoundingClientRect()
                  setMenu({ x: Math.max(4, e.clientX - bar.left), y: 0, index: i })
                }}
              >
                {tab.name}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t.addSheetLabel}
          title={t.addSheetLabel}
          onClick={() => gridStore.getState().addTab()}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {/* Ф3.5: при активных фильтрах — «Показано 132 из 1 500», иначе габариты */}
      <span className="sheets-note" aria-live="polite">
        {filters.length > 0
          ? t.filterShownOf(visibleRowsOf(sheet, filters)?.length ?? 0, sheet.maxRow + 1)
          : t.sheetRowsCols(sheet.rows, sheet.cols)}
      </span>

      {menu && (
        <>
          <div
            className="menu-backdrop"
            onClick={closeMenu}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div
            className="tab-menu"
            style={{ left: menu.x }}
            role="menu"
            aria-label={t.tabMenuLabel}
          >
            <button
              type="button"
              role="menuitem"
              className="tab-menu-item"
              onClick={() => {
                setEditing(menu.index)
                closeMenu()
              }}
            >
              <PenLine size={14} strokeWidth={1.5} aria-hidden />
              {t.tabRename}
            </button>
            <button
              type="button"
              role="menuitem"
              className="tab-menu-item"
              onClick={() => {
                gridStore.getState().duplicateTab(menu.index)
                closeMenu()
              }}
            >
              <Copy size={14} strokeWidth={1.5} aria-hidden />
              {t.tabDuplicate}
            </button>
            <button
              type="button"
              role="menuitem"
              className="tab-menu-item tab-menu-danger"
              disabled={tabs.length <= 1}
              onClick={() => {
                removeTab(menu.index)
                closeMenu()
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              {t.tabDelete}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
