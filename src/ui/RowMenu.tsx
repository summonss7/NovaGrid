import { Rows3, Pin, PinOff, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { useStore } from 'zustand'
import { normalize } from '../core/selection'
import { gridStore } from '../core/store'
import { useT } from '../i18n'
import { useMenuKeys } from './menuKeys'

/**
 * Меню строки (novagrid-045): ПКМ (и длинное нажатие) по номеру строки —
 * вставка/удаление строк и закрепление шапки по вертикали (novagrid-044).
 * Удаление затрагивает строки выделения, если кликнутая строка в нём
 * (выделили пять строк ПКМ-протяжкой — удалятся пять, как в Excel).
 */
export function RowMenu(props: { x: number; y: number; row: number; onClose: () => void }) {
  const t = useT()
  const freeze = useStore(gridStore, (s) => s.freeze)
  const selection = useStore(gridStore, (s) => s.selection)
  const menuRef = useRef<HTMLDivElement>(null)
  useMenuKeys(menuRef, props.onClose)
  const { row, onClose } = props

  // строки выделения, накрывающего кликнутую: Ctrl-области с ней же
  const span = selection.ranges
    .map(normalize)
    .filter((n) => row >= n.r1 && row <= n.r2)
    .reduce<{ r1: number; r2: number } | null>((acc, n) => acc ?? n, null)
  const first = span ? span.r1 : row
  const count = span ? span.r2 - span.r1 + 1 : 1

  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  const left = Math.min(props.x, window.innerWidth - 300)
  const top = Math.min(props.y, window.innerHeight - 380)

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        ref={menuRef}
        className="ctx-menu"
        style={{ left, top }}
        role="menu"
        aria-label={t.rowMenuLabel(row + 1)}
      >
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={act(() => gridStore.getState().insertRows(row, 1))}
        >
          <Rows3 size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.insertRowAbove}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={act(() => gridStore.getState().insertRows(row + 1, 1))}
        >
          <Rows3 size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.insertRowBelow}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={act(() => gridStore.getState().deleteRows(first, count))}
        >
          <Trash2 size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.deleteRows(count)}</span>
        </button>
        <div className="ctx-sep" aria-hidden />
        {freeze.rows > 0 ? (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => gridStore.getState().setFreeze(0, freeze.cols))}
          >
            <PinOff size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.freezeNone}</span>
          </button>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => gridStore.getState().setFreeze(row + 1, freeze.cols))}
          >
            <Pin size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.freezeRowsTo(row + 1)}</span>
          </button>
        )}
      </div>
    </>
  )
}
