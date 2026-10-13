/*
 * IndexedDB через Dexie (Этап 2.4, ARCHITECTURE §5): автосохранение рабочей
 * сессии и список «Недавние». Никаких серверов — всё локально в браузере.
 * Map в листе клонируется структурно, отдельная сериализация не нужна.
 * novagrid-022: таблица openings — файлы, которые открывали (переоткрытие
 * из «Недавних» по пути/хэндлу/снимку байтов).
 */

import Dexie, { type EntityTable } from 'dexie'
import type { SheetModel } from '../core/sheet'
import type { OpeningRow } from './recents'

export type { OpeningRow } from './recents'

export interface SessionRow {
  id?: number
  fileName: string | null
  savedAt: number
  /** суммарное число заполненных ячеек — для подписи в «Недавних» */
  cells: number
  sheets: { name: string; sheet: SheetModel }[]
}

class NovaDB extends Dexie {
  sessions!: EntityTable<SessionRow, 'id'>
  openings!: EntityTable<OpeningRow, 'id'>

  constructor() {
    super('novagrid')
    this.version(1).stores({ sessions: '++id, savedAt' })
    this.version(2).stores({ openings: '++id, openedAt, key' })
  }
}

export const db = new NovaDB()

/** Верхний порог для автосохранения: гигантские книги не сессируются —
 *  сериализация сотен тысяч ячеек заморозит вкладку (стресс проверяем файлом). */
export const AUTOSAVE_CELL_LIMIT = 150_000

const RECENT_LIMIT = 8

export function countCells(sheets: readonly { sheet: SheetModel }[]): number {
  let n = 0
  for (const s of sheets) n += s.sheet.cells.size
  return n
}

export async function saveSession(
  sheets: { name: string; sheet: SheetModel }[],
  fileName: string | null,
): Promise<void> {
  const row: SessionRow = {
    fileName,
    savedAt: Date.now(),
    cells: countCells(sheets),
    sheets: sheets.map((s) => ({ name: s.name, sheet: s.sheet })),
  }
  await db.sessions.add(row)
  // держим только последние N сессий
  const old = await db.sessions.orderBy('savedAt').reverse().offset(RECENT_LIMIT).toArray()
  if (old.length > 0) await db.sessions.bulkDelete(old.map((r) => r.id!).filter((id) => id != null))
}

export async function listRecents(limit = RECENT_LIMIT): Promise<SessionRow[]> {
  return db.sessions.orderBy('savedAt').reverse().limit(limit).toArray()
}

export async function deleteSession(id: number): Promise<void> {
  await db.sessions.delete(id)
}

/**
 * Стереть сессии несохранённых книг (fileName = null, novagrid-026):
 * автосейв их больше не создаёт, а в «Недавних» они не показываются —
 * старые записи со времён до фикса вычищаем со стартового экрана, чтобы
 * не висели в базе и не вытесняли полезные сессии (хранится только 8).
 */
export async function deleteUnnamedSessions(): Promise<void> {
  await db.sessions.filter((row) => row.fileName === null).delete()
}

/** Порог снимка байтов для переоткрытия без FSA: гигантские файлы не дублируем. */
export const OPENING_BYTES_LIMIT = 16 * 1024 * 1024

/**
 * Запомнить открытие файла (novagrid-022): дедуп по key — повторное открытие
 * поднимает запись вверх списком (openedAt = сейчас). Снимок байтов кладём
 * только в веб-fallback (нет ни пути, ни хэндла) и только для малых файлов.
 */
export async function recordOpening(
  file: File,
  meta: { path?: string; handle?: FileSystemFileHandle; key?: string } = {},
): Promise<void> {
  const key = (
    meta.key ?? meta.path ?? `${file.name}|${file.size}|${file.lastModified}`
  ).toLowerCase()
  const wantBytes = !meta.path && !meta.handle && file.size <= OPENING_BYTES_LIMIT
  const row: OpeningRow = {
    key,
    fileName: file.name,
    openedAt: Date.now(),
    ...(meta.path ? { path: meta.path } : {}),
    ...(meta.handle ? { handle: meta.handle } : {}),
    ...(wantBytes ? { bytes: await file.arrayBuffer() } : {}),
  }
  const existing = await db.openings.where('key').equals(key).first()
  // put вместо update: строка замещается целиком (устаревший bytes не застревает)
  await db.openings.put(existing?.id != null ? { ...row, id: existing.id } : row)
  const old = await db.openings.orderBy('openedAt').reverse().offset(RECENT_LIMIT).toArray()
  if (old.length > 0) await db.openings.bulkDelete(old.map((r) => r.id!).filter((id) => id != null))
}

export async function listOpenings(limit = RECENT_LIMIT): Promise<OpeningRow[]> {
  return db.openings.orderBy('openedAt').reverse().limit(limit).toArray()
}

export async function deleteOpening(id: number): Promise<void> {
  await db.openings.delete(id)
}
