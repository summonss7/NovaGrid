/*
 * «Недавние» стартового экрана (novagrid-022): объединение двух историй —
 * открытых файлов (openings) и автосохранённых сессий. Открытые файлы
 * должны стоять верхними: список сортируется по времени взаимодействия,
 * а при совпадении имени остаётся более свежая запись. Модуль чистый
 * (без Dexie) — слияние покрыто юнит-тестами напрямую.
 */

import type { SessionRow } from './db'

/** Файл, который открывали: как его переоткрыть из «Недавних». */
export interface OpeningRow {
  id?: number
  /** идентификатор файла для дедупа: путь (обёртка) | «имя|размер|mtime» (веб) */
  key: string
  fileName: string
  openedAt: number
  /** десктоп-обёртка: полный путь — переоткрытие читает файл с диска */
  path?: string
  /** веб (FSA/Chromium): хэндл — переоткрытие с запросом разрешения */
  handle?: FileSystemFileHandle
  /** веб-fallback (input/перетаскивание): снимок байтов малого файла */
  bytes?: ArrayBuffer
}

/** Пункт объединённого списка «Недавние». */
export type RecentItem =
  | { kind: 'open'; at: number; opening: OpeningRow }
  | { kind: 'session'; at: number; session: SessionRow }

/**
 * Слить открытия и сессии в один список: сортировка по времени убыванием,
 * дедуп по имени файла (без учёта регистра — как Windows) — выживает более
 * свежая запись. Сессии без имени («Несохранённая книга») не схлопываются.
 */
export function mergeRecents(
  openings: readonly OpeningRow[],
  sessions: readonly SessionRow[],
  limit = 8,
): RecentItem[] {
  const items: RecentItem[] = [
    ...openings.map((opening) => ({ kind: 'open' as const, at: opening.openedAt, opening })),
    ...sessions.map((session) => ({ kind: 'session' as const, at: session.savedAt, session })),
  ].sort((a, b) => b.at - a.at)
  const seen = new Set<string>()
  const merged: RecentItem[] = []
  for (const item of items) {
    const name = itemName(item)
    if (name !== null) {
      const dedupKey = name.toLowerCase()
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
    }
    merged.push(item)
    if (merged.length >= limit) break
  }
  return merged
}

function itemName(item: RecentItem): string | null {
  return item.kind === 'open' ? item.opening.fileName : item.session.fileName
}
