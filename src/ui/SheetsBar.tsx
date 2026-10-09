import { Copy, PenLine, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { visibleRowsOf } from '../core/filter'
import { gridStore } from '../core/store'
import { ru } from '../i18n/ru'

interface TabMenu {
  x: number
  y: number
  index: number
}

/** Панель листов (§6 + Этап 2.2): вкладки — переключение, переименование
 *  (двойной клик), дублирование и удаление (меню ПКМ), добавление (+). */
export function SheetsBar() {
  const tabs = useStore(gridStore, (s) => s.tabs)
  const activeTab = useStore(gridStore, (s) => s.activeTab)
  const sheet = useStore(gridStore, (s) => s.sheet)
  const filters = useStore(gridStore, (s) => s.filters)
  const [menu, setMenu] = useState<TabMenu | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing !== null) inputRef.current?.select()
  }, [editing])

  const closeMenu = () => setMenu(null)

  const removeTab = (index: number) => {
    const tab = tabs[index]
    const hasContent = tab.sheet.cells.size > 0
    if (hasContent && !window.confirm(ru.tabDeleteConfirm(tab.name))) return
    gridStore.getState().removeTab(index)
  }

  const commitRename = () => {
    if (editing === null) return
    const value = inputRef.current?.value ?? ''
    if (value.trim() !== '') gridStore.getState().renameTab(editing, value)
    setEditing(null)
  }

  return (
    <div className="sheets-bar">
      <div className="sheets-tabs" role="tablist" aria-label="Листы книги">
        {tabs.map((tab, i) => (
          <div key={tab.id} className="sheet-tab-wrap">
            {editing === i ? (
              <input
                ref={inputRef}
                className="sheet-tab-rename"
                defaultValue={tab.name}
                aria-label={ru.tabRename}
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
          aria-label={ru.addSheetLabel}
          title={ru.addSheetLabel}
          onClick={() => gridStore.getState().addTab()}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {/* Ф3.5: при активных фильтрах — «Показано 132 из 1 500», иначе габариты */}
      <span className="sheets-note" aria-live="polite">
        {filters.length > 0
          ? ru.filterShownOf(visibleRowsOf(sheet, filters)?.length ?? 0, sheet.maxRow + 1)
          : ru.sheetRowsCols(sheet.rows, sheet.cols)}
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
            aria-label={ru.tabMenuLabel}
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
              {ru.tabRename}
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
              {ru.tabDuplicate}
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
              {ru.tabDelete}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
