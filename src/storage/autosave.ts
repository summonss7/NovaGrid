/*
 * Автосохранение сессии (Этап 2.4): каждое изменение книги дебаунсится и
 * уходит в IndexedDB; pagehide/скрытие вкладки сбрасывают буфер немедленно —
 * после краша/закрытия книга восстанавливается из «Недавних» на стартовом
 * экране. Правки выделения сессию не трогают (сравнение по ссылке tabs).
 * novagrid-026: сессируются только книги с файлом (fileName ≠ null) —
 * «Несохранённая книга» плодилась на каждое закрытие приложения даже без
 * открытого файла и засоряла «Недавние»; восстанавливать было нечего.
 */

import { gridStore } from '../core/store'
import { AUTOSAVE_CELL_LIMIT, countCells, saveSession } from './db'

const DEBOUNCE_MS = 1000

export function installAutosave(): () => void {
  let timer = 0
  let lastTabs: unknown = null
  let lastFileName: string | null = null
  let saving = false
  let pendingAgain = false

  const flush = () => {
    if (saving) {
      pendingAgain = true
      return
    }
    const st = gridStore.getState()
    // novagrid-026: несохранённые книги не сессируем — без файла запись
    // «Несохранённая книга» попадала в «Недавние» на каждое закрытие
    // приложения (pagehide), даже когда никакой файл не открывали
    if (st.fileName === null) return
    const cells = countCells(st.tabs)
    if (cells > AUTOSAVE_CELL_LIMIT) return // гигантские книги не сессируем
    saving = true
    lastTabs = st.tabs
    lastFileName = st.fileName
    void saveSession(st.tabs, st.fileName)
      .catch(() => undefined) // IndexedDB может быть недоступна (private mode) — молча
      .finally(() => {
        saving = false
        if (pendingAgain) {
          pendingAgain = false
          flush()
        }
      })
  }

  const schedule = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = 0
      flush()
    }, DEBOUNCE_MS)
  }

  const unsub = gridStore.subscribe((st) => {
    if (st.tabs === lastTabs && st.fileName === lastFileName) return
    schedule()
  })

  const onPageHide = () => {
    if (timer) window.clearTimeout(timer)
    flush()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onPageHide()
  }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    unsub()
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibility)
    if (timer) window.clearTimeout(timer)
  }
}
