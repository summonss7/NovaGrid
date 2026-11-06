/*
 * Клавиатура всплывающих меню (Этап 6.2): при открытии фокус в первый пункт,
 * ↑↓/Home/End ходят по пунктам циклично, Esc закрывает. Паттерн WAI-ARIA
 * role="menu": фокус не уходит из меню, пока оно открыто. itemSelector=null —
 * стрелки не перехватываются (например, когда фокус в поле поиска меню).
 * Esc закрывает меню из любого места, даже если фокус ушёл из него (novagrid-061).
 */

import { useEffect, type RefObject } from 'react'

export function useMenuKeys(
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { itemSelector?: string | null; autoFocusSelector?: string | null } = {},
): void {
  const { itemSelector = '.ctx-item', autoFocusSelector = itemSelector } = opts

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const bySelector = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)]

    if (autoFocusSelector) bySelector(autoFocusSelector)[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // фокус мог уйти из меню (клик по гриду и т.п.) — слушатель живёт
        // на document; stopPropagation не даёт гриду снять выделение
        // вместо закрытия меню (novagrid-061)
        e.stopPropagation()
        onClose()
        return
      }
      if (!itemSelector) return
      // стрелки ходят по пунктам, только пока фокус внутри меню
      if (!root.contains(document.activeElement)) return
      const list = bySelector(itemSelector)
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || list.length === 0) return
      e.preventDefault()
      const idx = list.indexOf(document.activeElement as HTMLElement)
      let next = 0
      if (e.key === 'ArrowDown') next = (idx + 1) % list.length
      else if (e.key === 'ArrowUp') next = (idx <= 0 ? list.length : idx) - 1
      else if (e.key === 'End') next = list.length - 1
      // отключённые пункты получают фокус «впустую» и стрелки застревают на
      // них (объединение ячеек недоступно на одиночной ячейке, novagrid-047) —
      // навигация идёт по цепочке до ближайшего активного
      if ((list[next] as HTMLButtonElement).disabled) {
        const dir = e.key === 'ArrowUp' ? -1 : 1
        for (let step = 1; step <= list.length; step++) {
          const cand = (next + dir * step + list.length * 2) % list.length
          if (!(list[cand] as HTMLButtonElement).disabled) {
            next = cand
            break
          }
        }
      }
      list[next]?.focus()
    }
    // document + capture: Esc закрывает меню из любого места, а не только
    // при фокусе внутри (novagrid-061)
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [rootRef, onClose, itemSelector, autoFocusSelector])
}
