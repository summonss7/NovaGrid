import { ClipboardPaste, Copy, Eraser, Filter, FilterX, ListPlus, Scissors } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { selectionText, rememberCopy } from '../core/copy'
import { colName } from '../grid/geometry'
import { gridStore } from '../core/store'
import { cellText } from '../formula/engine'
import { useT } from '../i18n'
import { copyText } from './clipboard'
import { useMenuKeys } from './menuKeys'

/**
 * Контекстное меню ПКМ по ячейке (CONCEPT Ф3, DESIGN-SYSTEM §7; novagrid-032).
 * Первая группа — основные операции, как в Excel: вырезать/копировать/вставить/
 * удалить содержимое (блок — по выделению). Дальше ключевой жест ТЗ:
 * «Фильтровать: A = «Иванов»», инверсия, добавление значения к фильтру, сброс.
 * Вставка читает системный буфер (Clipboard API); если браузер не дал
 * разрешение — меню остаётся с подсказкой, Ctrl+V работает всегда.
 */
export function ContextMenu(props: {
  x: number
  y: number
  row: number
  col: number
  onClose: () => void
}) {
  const t = useT()
  const filters = useStore(gridStore, (s) => s.filters)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pasteHint, setPasteHint] = useState(false)
  useMenuKeys(menuRef, props.onClose)

  // асинхронные пункты (буфер) закрывают меню только пока оно открыто:
  // если пользователь успел переоткрыть меню, чужое закрытие не должно
  // хлопнуть новым — экземпляр размонтируется при смене key row:col
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  const closeIfAlive = () => {
    if (aliveRef.current) props.onClose()
  }

  const st = gridStore.getState()
  // отображаемое значение: фильтры сравнивают то, что видно (формулы вычислены)
  const raw = cellText(st.sheet, props.row, props.col)
  const value = raw === '' ? t.filterBlanks : raw
  const letter = colName(props.col)
  const colFilter = filters.find((f) => f.col === props.col)
  const canAdd =
    colFilter !== undefined && colFilter.mode === 'include' && !colFilter.values.includes(raw)

  const act = (fn: () => void) => () => {
    fn()
    props.onClose()
  }

  const copyValue = async (text: string) => {
    await copyText(text)
    closeIfAlive()
  }

  // блок выделения (TSV) — то, что кладут в буфер Ctrl+C/Ctrl+X;
  // копирование блока помнит формулы для вставки со сдвигом (novagrid-037)
  const blockText = selectionText(st.sheet, st.selection)
  const copyBlock = async () => {
    rememberCopy(st.sheet, st.selection, blockText)
    await copyValue(blockText)
  }

  const cutSelection = async () => {
    if (await copyText(blockText)) st.deleteSelection()
    closeIfAlive()
  }

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      // жест актуален, только пока это меню открыто: чтение буфера может
      // длиться долго (запрос разрешения) и пережить закрытие/замену меню —
      // поздняя вставка падала бы в изменившиеся ячейки
      if (aliveRef.current) {
        if (text !== '') st.pasteText(text)
        props.onClose()
      }
    } catch {
      // разрешения нет (браузер спросил и отказали / WebView) — Ctrl+V доступен всегда
      if (aliveRef.current) setPasteHint(true)
    }
  }

  // строка для «Копировать строку»: значения колонок контента через таб
  const rowText = Array.from({ length: st.sheet.maxCol + 1 }, (_, c) =>
    cellText(st.sheet, props.row, c),
  ).join('\t')

  // не вылезать за пределы окна
  const left = Math.min(props.x, window.innerWidth - 300)
  const top = Math.min(props.y, window.innerHeight - 440)

  return (
    <>
      <div
        className="menu-backdrop"
        onClick={props.onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={menuRef}
        className="ctx-menu"
        style={{ left, top }}
        role="menu"
        aria-label={t.ctxMenuLabel}
      >
        <div className="ctx-clip-group" role="group" aria-label={t.ctxClipboardGroup}>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => void cutSelection()}
          >
            <Scissors size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.ctxCut}</span>
            <span className="ctx-key" aria-hidden>
              Ctrl+X
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => void copyBlock()}
          >
            <Copy size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.ctxCopy}</span>
            <span className="ctx-key" aria-hidden>
              Ctrl+C
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={() => void pasteFromClipboard()}
          >
            <ClipboardPaste size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.ctxPaste}</span>
            <span className="ctx-key" aria-hidden>
              Ctrl+V
            </span>
          </button>
          <button type="button" role="menuitem" className="ctx-item" onClick={act(() => st.deleteSelection())}>
            <Eraser size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.ctxClear}</span>
            <span className="ctx-key" aria-hidden>
              Del
            </span>
          </button>
        </div>
        {pasteHint && <div className="ctx-note">{t.ctxPasteUnavailable}</div>}
        <div className="ctx-sep" aria-hidden />
        <button
          type="button"
          role="menuitem"
          className="ctx-item ctx-item-primary"
          onClick={act(() => st.filterByValue(props.col, raw))}
        >
          <Filter size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.ctxFilterEqual(letter, value)}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={act(() => st.excludeByValue(props.col, raw))}
        >
          <FilterX size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.ctxFilterNotEqual(letter, value)}</span>
        </button>
        {canAdd && (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => st.addValueToFilter(props.col, raw))}
          >
            <ListPlus size={14} strokeWidth={1.5} aria-hidden />
            <span className="ctx-item-text">{t.ctxAddValue(value)}</span>
          </button>
        )}
        {colFilter && (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => st.clearColumnFilter(props.col))}
          >
            <span className="ctx-item-text">{t.ctxClearColumn(letter)}</span>
          </button>
        )}
        {filters.length > 0 && (
          <button
            type="button"
            role="menuitem"
            className="ctx-item"
            onClick={act(() => st.clearAllFilters())}
          >
            <span className="ctx-item-text">{t.ctxClearAll}</span>
          </button>
        )}
        <div className="ctx-sep" aria-hidden />
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => void copyValue(raw)}
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.ctxCopyCell}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="ctx-item"
          onClick={() => void copyValue(rowText)}
        >
          <Copy size={14} strokeWidth={1.5} aria-hidden />
          <span className="ctx-item-text">{t.ctxCopyRow}</span>
        </button>
      </div>
    </>
  )
}
