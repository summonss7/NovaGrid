/*
 * Клавиатура всплывающих меню (Этап 6.2): при открытии фокус в первый пункт,
 * ↑↓/Home/End ходят по пунктам циклично, Esc закрывает. Паттерн WAI-ARIA
 * role="menu": фокус не уходит из меню, пока оно открыто. itemSelector=null —
 * стрелки не перехватываются (например, когда фокус в поле поиска меню).
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
        onClose()
        return
      }
      if (!itemSelector) return
      const list = bySelector(itemSelector)
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || list.length === 0) return
      e.preventDefault()
      const idx = list.indexOf(document.activeElement as HTMLElement)
      let next = 0
      if (e.key === 'ArrowDown') next = (idx + 1) % list.length
      else if (e.key === 'ArrowUp') next = (idx <= 0 ? list.length : idx) - 1
      else if (e.key === 'End') next = list.length - 1
      list[next]?.focus()
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [rootRef, onClose, itemSelector, autoFocusSelector])
}
