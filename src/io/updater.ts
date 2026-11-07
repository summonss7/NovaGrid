/*
 * OTA-обновления из центра Aila (novagrid-036, концепция —
 * D:\Scheduler\UPDATES-SYSTEM.md §3): тихая проверка при старте (метка
 * времени в localStorage — окна книги делят её с главным) и ручная «Справка
 * → Проверить обновления…». Доступное обновление открывает диалог с «что
 * нового» и кнопкой «Обновить» (скачивание со сверкой sha256 — в обёртке).
 * Недоступный центр деградирует молча: «не удалось проверить» — не ошибка.
 * Браузерная сборка (PWA) сюда не заходит — обновляет Service Worker.
 *
 * novagrid-063: та же механика на мобильной обёртке Android — ассет APK,
 * тихая проверка чаще (раз в 10 минут, как LeCards lecards-027), установка —
 * системный установщик через JNI-мост mobile.ts (не rename-swap, как на
 * десктопе): после команды диалог остаётся с подсказкой подтвердить
 * установку; «needs-permission» ведёт в настройки источника.
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
import {
  isTauriMobile,
  mobileUpdateCheck,
  mobileUpdateDownload,
  mobileUpdateInstall,
  onMobileUpdaterProgress,
} from './mobile'

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restarting'
  | 'needs-permission'
  | 'error'

const DAY_MS = 24 * 60 * 60 * 1000
/** Мобильная тихая проверка чаще: сессии короткие, канал живой (lecards-027). */
const MOBILE_THROTTLE_MS = 10 * 60 * 1000
const LAST_CHECK_KEY = 'novagrid-update-last-check'

/** Период тихой проверки платформы (десктоп — сутки, мобильная — 10 минут). */
export function silentCheckPeriod(): number {
  return isTauriMobile() ? MOBILE_THROTTLE_MS : DAY_MS
}

/** Тихая проверка нужна: ещё не проверяли или вышел период платформы. */
export function shouldSilentCheck(lastCheck: number | null, now: number, periodMs = DAY_MS): boolean {
  return lastCheck === null || now - lastCheck > periodMs
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
  /** «Обновить»: десктоп — скачать → сессия → swap + перезапуск; мобильная —
   * скачать → системный установщик (подтверждение на стороне Android). */
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
    if (!isDesktop() && !isTauriMobile()) return
    const onProgress = (p: { downloaded: number; total: number }) => {
      if (get().status === 'downloading') {
        set({ downloaded: p.downloaded, total: p.total || get().total })
      }
    }
    if (isDesktop()) onDesktopUpdaterProgress(onProgress)
    else onMobileUpdaterProgress(onProgress)
    if (shouldSilentCheck(readLastCheck(), Date.now(), silentCheckPeriod())) {
      await get().check(false)
    }
  },

  async check(manual) {
    if (get().status === 'checking' || get().status === 'downloading') return
    if (manual) set({ status: 'checking', error: null, dialogOpen: true })
    const r = isDesktop() ? await desktopUpdateCheck() : await mobileUpdateCheck()
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
      if (isDesktop()) {
        const tmp = await desktopUpdateDownload(a.url, a.sha256, a.size ?? 0)
        set({ status: 'restarting' })
        // updater_apply завершает процесс: обычные обработчики закрытия не
        // сработают — сессию текущей книги пишем на диск заранее
        await flushSession()
        await desktopUpdateApply(tmp)
        // при успехе приложение перезапускается; возврат — apply не удался
      } else {
        const tmp = await mobileUpdateDownload(a.url, a.sha256, a.size ?? 0)
        const res = await mobileUpdateInstall(tmp)
        // системный установщик открыт: приложение продолжает жить, Android
        // сам допоставит и перезапустит; needs-permission — пользователь
        // разрешает источник и жмёт «Обновить» снова
        set({ status: res === 'needs-permission' ? 'needs-permission' : 'installing' })
      }
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}))
