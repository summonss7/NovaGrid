/*
 * OTA-обновления десктопа из центра Aila (novagrid-036, концепция —
 * D:\Scheduler\UPDATES-SYSTEM.md §3): тихая проверка при старте (не чаще
 * раза в сутки, метка времени в localStorage — окна книги делят её с
 * главным) и ручная «Справка → Проверить обновления…». Доступное
 * обновление открывает диалог с «что нового» и кнопкой «Обновить»
 * (скачивание со сверкой sha256 и rename-swap — в обёртке). Недоступный
 * центр деградирует молча: «не удалось проверить» — не ошибка.
 * Браузерная сборка (PWA) сюда не заходит — обновляет Service Worker.
 */

import { create } from 'zustand'
import { flushSession } from '../storage/autosave'
import {
  desktopUpdateApply,
  desktopUpdateCheck,
  desktopUpdateDownload,
  isDesktop,
  onDesktopUpdaterProgress,
  type UpdateAsset,
} from './desktop'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'restarting'
  | 'error'

const DAY_MS = 24 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'novagrid-update-last-check'

/** Тихая проверка нужна: ещё не проверяли или прошло больше суток. */
export function shouldSilentCheck(lastCheck: number | null, now: number): boolean {
  return lastCheck === null || now - lastCheck > DAY_MS
}

function readLastCheck(): number | null {
  const raw = localStorage.getItem(LAST_CHECK_KEY)
  const n = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(n) ? n : null
}

interface UpdaterState {
  status: UpdaterStatus
  dialogOpen: boolean
  current: string
  latest: string | null
  notes: string | null
  publishedAt: string | null
  asset: UpdateAsset | null
  downloaded: number
  total: number
  error: string | null
  /** Старт приложения: подписать прогресс и при необходимости тихо проверить. */
  init: () => Promise<void>
  /** Проверить канал: manual=true всегда открывает диалог с исходом. */
  check: (manual: boolean) => Promise<void>
  /** «Обновить»: скачать → зафиксировать сессию → swap + перезапуск. */
  install: () => Promise<void>
  openDialog: () => void
  closeDialog: () => void
}

export const useUpdaterStore = create<UpdaterState>()((set, get) => ({
  status: 'idle',
  dialogOpen: false,
  current: '',
  latest: null,
  notes: null,
  publishedAt: null,
  asset: null,
  downloaded: 0,
  total: 0,
  error: null,

  async init() {
    if (!isDesktop()) return
    onDesktopUpdaterProgress((p) => {
      if (get().status === 'downloading') {
        set({ downloaded: p.downloaded, total: p.total || get().total })
      }
    })
    if (shouldSilentCheck(readLastCheck(), Date.now())) await get().check(false)
  },

  async check(manual) {
    if (get().status === 'checking' || get().status === 'downloading') return
    if (manual) set({ status: 'checking', error: null, dialogOpen: true })
    const r = await desktopUpdateCheck()
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
    set({
      current: r.current,
      latest: r.latest,
      notes: r.notes,
      publishedAt: r.publishedAt,
      asset: r.asset,
      // тихая проверка без обновления ничего не показывает (status → idle)
      status: r.status === 'available' ? 'available' : manual ? (r.status === 'latest' ? 'latest' : 'error') : 'idle',
      error: r.status === 'latest' || r.status === 'available' ? null : r.error,
      dialogOpen: r.status === 'available' ? true : get().dialogOpen,
    })
  },

  async install() {
    const a = get().asset
    if (!a?.sha256 || !a.url) return
    set({ status: 'downloading', downloaded: 0, total: a.size ?? 0, error: null })
    try {
      const tmp = await desktopUpdateDownload(a.url, a.sha256, a.size ?? 0)
      set({ status: 'restarting' })
      // updater_apply завершает процесс: обычные обработчики закрытия не
      // сработают — сессию текущей книги пишем на диск заранее
      await flushSession()
      await desktopUpdateApply(tmp)
      // при успехе приложение перезапускается; возврат — apply не удался
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}))
