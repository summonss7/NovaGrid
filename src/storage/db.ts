/*
 * IndexedDB через Dexie (Этап 2.4, ARCHITECTURE §5): автосохранение рабочей
 * сессии и список «Недавние». Никаких серверов — всё локально в браузере.
 * Map в листе клонируется структурно, отдельная сериализация не нужна.
 */

import Dexie, { type EntityTable } from 'dexie'
import type { SheetModel } from '../core/sheet'

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

  constructor() {
    super('novagrid')
    this.version(1).stores({ sessions: '++id, savedAt' })
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
