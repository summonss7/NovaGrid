/*
 * IndexedDB через Dexie (Этап 2.4, ARCHITECTURE §5): автосохранение рабочей
 * сессии и список «Недавние». Никаких серверов — всё локально в браузере.
 * Map в листе клонируется структурно, отдельная сериализация не нужна.
 * novagrid-022: таблица openings — файлы, которые открывали (переоткрытие
 * из «Недавних» по пути/хэндлу/снимку байтов).
 */

import Dexie, { type EntityTable } from 'dexie'
import type { SheetModel } from '../core/sheet'
import type { SheetWire } from '../core/workbook'
import type { OpeningRow } from './recents'

export type { OpeningRow } from './recents'

export interface SessionRow {
  id?: number
  fileName: string | null
  savedAt: number
  /** суммарное число заполненных ячеек — для подписи в «Недавних» */
  cells: number
  /** листы с ширинами/закреплением (novagrid-050); старые записи — без них */
  sheets: SheetWire[]
}

/**
 * Память «где я был» в открытой книге (novagrid-037): последний лист и
 * курсор. Ключ — тот же, что у «Недавних» (openingKey), храним немного.
 */
export interface ViewStateRow {
  key: string
  fileName: string
  sheetName: string
  row: number
  col: number
  updatedAt: number
}

class NovaDB extends Dexie {
  sessions!: EntityTable<SessionRow, 'id'>
  openings!: EntityTable<OpeningRow, 'id'>
  viewStates!: EntityTable<ViewStateRow, 'key'>

  constructor() {
    super('novagrid')
    this.version(1).stores({ sessions: '++id, savedAt' })
    this.version(2).stores({ openings: '++id, openedAt, key' })
    this.version(3).stores({ viewStates: 'key, updatedAt' })
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
  sheets: readonly SheetWire[],
  fileName: string | null,
): Promise<void> {
  const row: SessionRow = {
    fileName,
    savedAt: Date.now(),
    cells: countCells(sheets),
    // провод целиком: с ширинами колонок и закреплением (novagrid-050);
    // Map клонируется структурно, ReadonlyMap в IndexedDB лежит как Map
    sheets: sheets.map((s) => ({ ...s })),
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
 * Идентификатор файла для «Недавних» и памяти позиции (novagrid-037):
 * ключ из хаба → путь обёртки → «имя|размер|mtime». Одна формула — открытие
 * и переоткрытие дают один ключ.
 */
export function openingKey(
  file: File,
  meta: { path?: string; handle?: FileSystemFileHandle; key?: string } = {},
): string {
  return (
    meta.key ?? meta.path ?? `${file.name}|${file.size}|${file.lastModified}`
  ).toLowerCase()
}

/**
 * Запомнить открытие файла (novagrid-022): дедуп по key — повторное открытие
 * поднимает запись вверх списком (openedAt = сейчас). Снимок байтов кладём
 * только в веб-fallback (нет ни пути, ни хэндла) и только для малых файлов.
 */
export async function recordOpening(
  file: File,
  meta: { path?: string; handle?: FileSystemFileHandle; key?: string } = {},
): Promise<void> {
  const key = openingKey(file, meta)
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

// ── память «где я был» (novagrid-037) ─────────────────────────────────────

/** Сколько книг помнят позицию — как «Недавние», только с запасом. */
const VIEW_STATE_LIMIT = 32

export async function saveViewState(row: ViewStateRow): Promise<void> {
  await db.viewStates.put(row)
  const old = await db.viewStates
    .orderBy('updatedAt')
    .reverse()
    .offset(VIEW_STATE_LIMIT)
    .toArray()
  if (old.length > 0) await db.viewStates.bulkDelete(old.map((r) => r.key))
}

export async function loadViewState(key: string): Promise<ViewStateRow | null> {
  return (await db.viewStates.get(key)) ?? null
}
