/*
 * Память «где я был» в книге (novagrid-037): после закрытия файла программа
 * помнит последний лист и позицию курсора и возвращает туда при повторном
 * открытии. С novagrid-053 помнит позицию КАЖДОГО листа: вход на лист
 * возвращает курсор туда, где на нём закончили работу. Ключ книги тот же,
 * что у «Недавних» (openingKey). Запись — дебаунсом на смену листа/курсора
 * и немедленно при pagehide/скрытии вкладки (закрытие окна книги в обёртке —
 * тоже pagehide); смена книги сначала досылает позицию предыдущей (beginTracking).
 *
 * planRestore вынесен чистой функцией — лист ищется по имени (id вкладок
 * пересоздаются при загрузке), координаты клампятся к границам листа.
 */

import { gridStore } from '../core/store'
import { loadViewState, saveViewState, type ViewStateRow } from './db'

const DEBOUNCE_MS = 800

/** Ключ книги, чью позицию сейчас помним; null — книга без файла, не помним. */
let trackedKey: string | null = null
let timer = 0
let saving = false

function snapshot(): ViewStateRow | null {
  const st = gridStore.getState()
  if (trackedKey === null || st.fileName === null) return null
  return {
    key: trackedKey,
    fileName: st.fileName,
    sheetName: st.tabs[st.activeTab]?.name ?? '',
    row: st.selection.active.row,
    col: st.selection.active.col,
    // курсор каждого листа (novagrid-053): вход на лист возвращает туда, где был
    sheets: st.tabCursorsWire(),
    updatedAt: Date.now(),
  }
}

function flushViewState(): void {
  if (timer) window.clearTimeout(timer)
  timer = 0
  const row = snapshot()
  if (!row || saving) return
  saving = true
  void saveViewState(row)
    .catch(() => undefined) // IndexedDB недоступна (приватный режим) — молча
    .finally(() => {
      saving = false
    })
}

/**
 * Переключить отслеживаемую книгу: позиция предыдущей досылается немедленно.
 * Вызывать ДО загрузки новой книги (пока стор держит старую — flush снимает
 * позицию старой под старым ключом). null — файла нет (стартовый экран,
 * новая книга, фикстура): позицию не пишем.
 */
export function beginViewStateTracking(key: string | null): void {
  if (key === trackedKey) {
    if (key) flushViewState()
    return
  }
  flushViewState()
  trackedKey = key
}

/** Ключ книги, чью позицию сейчас помним (для отката при неудачном открытии). */
export function trackingKey(): string | null {
  return trackedKey
}

/** Прочитать запомненную позицию книги (null — не помним или БД недоступна). */
export async function restoreViewState(key: string): Promise<ViewStateRow | null> {
  try {
    return await loadViewState(key)
  } catch {
    return null
  }
}

/**
 * Куда вернуть курсор: индекс вкладки по имени листа + кламп координат.
 * Лист переименован/удалён — null, остаёмся на A1 (лучше, чем прыжок в
 * неправильное место).
 */
export function planRestore(
  tabs: readonly { name: string; rows: number; cols: number }[],
  saved: { sheetName: string; row: number; col: number },
): { tabIndex: number; row: number; col: number } | null {
  const tabIndex = tabs.findIndex((t) => t.name === saved.sheetName)
  if (tabIndex < 0) return null
  const t = tabs[tabIndex]
  return {
    tabIndex,
    row: Math.min(Math.max(saved.row, 0), Math.max(t.rows - 1, 0)),
    col: Math.min(Math.max(saved.col, 0), Math.max(t.cols - 1, 0)),
  }
}

/**
 * Применить запомненную позицию к загруженной книге: вкладка по имени,
 * затем курсор (goTo прокрутит ячейку в поле зрения — подписка грида).
 * Позиции остальных листов (novagrid-053) сеются в по-вкладочную память —
 * вход на любой лист вернёт курсор туда, где на нём были в прошлый раз.
 */
export function applyViewState(saved: ViewStateRow): void {
  const st = gridStore.getState()
  const plan = planRestore(
    st.tabs.map((t) => ({ name: t.name, rows: t.sheet.rows, cols: t.sheet.cols })),
    saved,
  )
  if (plan) {
    if (plan.tabIndex !== st.activeTab) st.activateTab(plan.tabIndex)
    if (plan.row !== 0 || plan.col !== 0) gridStore.getState().goTo(plan.row, plan.col)
  }
  if (saved.sheets) gridStore.getState().seedTabCursors(saved.sheets)
}

/** Подписка на позицию + досыл при закрытии. Возвращает отписку. */
export function installViewStateSync(): () => void {
  let lastTab = -1
  let lastRow = -1
  let lastCol = -1
  const unsub = gridStore.subscribe((st) => {
    const row = st.selection.active.row
    const col = st.selection.active.col
    if (st.activeTab === lastTab && row === lastRow && col === lastCol) return
    lastTab = st.activeTab
    lastRow = row
    lastCol = col
    if (trackedKey === null || timer) return
    timer = window.setTimeout(() => {
      timer = 0
      flushViewState()
    }, DEBOUNCE_MS)
  })
  const onPageHide = () => flushViewState()
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
    timer = 0
  }
}
