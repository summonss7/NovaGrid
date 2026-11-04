/*
 * Снапшот-капсула .nvgridx (Этап 7.6, novagrid-019; схема А утверждена
 * владельцем в Aila «Хаб ИИ» 12.10.2026): вся книга одним файлом,
 * зашифрованным AES-GCM (WebCrypto), ключ — PBKDF2-HMAC-SHA256 из парольной
 * фразы. Файл кладётся в любую облачную папку владельца: провайдер видит
 * только шифротекст, конфликты версий решает облако копией — «побеждает
 * последний». Модуль без DOM: только WebCrypto и чистые преобразования,
 * поэтому гоняется и в браузере, и в Node-юнитах.
 *
 * Формат контейнера (бинарный):
 *   байты 0–7   : «NVGRIDX» + 0x01 — магия и версия формата капсулы
 *   байты 8–23  : соль PBKDF2 (16 байт, свежая на каждый экспорт)
 *   байты 24–35 : IV AES-GCM (12 байт)
 *   байты 36–   : шифротекст JSON полезной нагрузки
 * Заголовок (0–35) идёт в AAD: подделка любого байта ломает тег GCM.
 */

import type { MergeRect } from '../core/merges'
import type { CellStyle, SheetModel } from '../core/sheet'
import type { SheetWire } from '../core/workbook'

/** Расширение капсулы; mime — октет-стрим (содержимое непрозрачно). */
export const SNAPSHOT_EXT = 'nvgridx'

/** Соль/IV/заголовок капсулы; версия формата зашита в 8-й байт магии. */
const SALT_BYTES = 16
const IV_BYTES = 12
const HEADER_BYTES = 8 + SALT_BYTES + IV_BYTES
/** PBKDF2-HMAC-SHA256, ориентир OWASP 2023 — ~0,1–0,3 с на десктопе. */
const PBKDF2_ITERATIONS = 310_000

const MAGIC = Uint8Array.of(0x4e, 0x56, 0x47, 0x52, 0x49, 0x44, 0x58, 0x01)

/** Лист в JSON-представлении (Map → Record для честного JSON.stringify). */
interface SnapshotSheet {
  name: string
  cells: Record<string, string>
  styles: Record<string, CellStyle>
  formulaCache?: Record<string, string>
  /** объединённые ячейки (novagrid-047); отсутствие — объединений нет */
  merges?: MergeRect[]
  /** ширины колонок (novagrid-050): индекс (строкой) → базовые единицы */
  colWidths?: Record<string, number>
  /** закрепление областей (novagrid-050); отсутствие — нет */
  freeze?: { rows: number; cols: number }
  rows: number
  cols: number
  maxRow: number
  maxCol: number
}

/**
 * Полезная нагрузка капсулы. Содержимое — то же, что держит автосохранение
 * сессии (Dexie): модель всех листов + имя файла + разделитель CSV, а с
 * novagrid-050 ещё ширины колонок и закрепление каждого листа.
 * Фильтры не ездят — как у сессии.
 */
export interface SnapshotPayload {
  app: 'NovaGrid'
  format: 1
  savedAt: string
  book: {
    fileName: string | null
    csvDelimiter: string
    sheets: SnapshotSheet[]
  }
}

/** Восстановленная капсула для store.loadBook (+ метаданные файла). */
export interface DecodedSnapshot {
  payload: SnapshotPayload
  wire: { sheets: SheetWire[] }
}

export function isSnapshotName(name: string): boolean {
  return name.toLowerCase().endsWith('.' + SNAPSHOT_EXT)
}

/** Проверка магии по буферу — снапшот ли это (до запроса пароля). */
export function isSnapshotBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_BYTES) return false
  const head = new Uint8Array(buffer, 0, 8)
  for (let i = 0; i < 8; i++) if (head[i] !== MAGIC[i]) return false
  return true
}

function mapToRecord<V>(map: Map<string, V>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [k, v] of map) out[k] = v
  return out
}

function recordToMap<V>(rec: Record<string, V> | undefined): Map<string, V> {
  const out = new Map<string, V>()
  if (rec) for (const k of Object.keys(rec)) out.set(k, rec[k])
  return out
}

/** Книга из стора → полезная нагрузка капсулы (сериализуемая). */
export function bookToSnapshot(
  sheets: readonly SheetWire[],
  meta: { fileName: string | null; csvDelimiter: string },
): SnapshotPayload {
  return {
    app: 'NovaGrid',
    format: 1,
    savedAt: new Date().toISOString(),
    book: {
      fileName: meta.fileName,
      csvDelimiter: meta.csvDelimiter,
      sheets: sheets.map((wire) => {
        const s: SnapshotSheet = {
          name: wire.name,
          cells: mapToRecord(wire.sheet.cells),
          styles: mapToRecord(wire.sheet.styles),
          rows: wire.sheet.rows,
          cols: wire.sheet.cols,
          maxRow: wire.sheet.maxRow,
          maxCol: wire.sheet.maxCol,
        }
        if (wire.sheet.formulaCache && wire.sheet.formulaCache.size > 0) {
          s.formulaCache = mapToRecord(wire.sheet.formulaCache)
        }
        if (wire.sheet.merges && wire.sheet.merges.length > 0) {
          s.merges = wire.sheet.merges.map((m) => ({ ...m }))
        }
        if (wire.colWidths && wire.colWidths.size > 0) {
          const widths: Record<string, number> = {}
          for (const [c, w] of wire.colWidths) widths[String(c)] = w
          s.colWidths = widths
        }
        if (wire.freeze && (wire.freeze.rows > 0 || wire.freeze.cols > 0)) {
          s.freeze = { ...wire.freeze }
        }
        return s
      }),
    },
  }
}

/** Полезная нагрузка → модель для loadBook (Map восстановлены). */
export function snapshotToBook(payload: SnapshotPayload): DecodedSnapshot['wire'] {
  const sheets: SheetWire[] = payload.book.sheets.map((s) => {
    const widths = s.colWidths
      ? new Map(Object.entries(s.colWidths).map(([c, w]) => [Number(c), w]))
      : undefined
    return {
      name: s.name,
      sheet: {
        cells: recordToMap(s.cells),
        styles: recordToMap(s.styles),
        ...(s.merges ? { merges: s.merges.map((m) => ({ ...m })) } : {}),
        ...(s.formulaCache ? { formulaCache: recordToMap(s.formulaCache) } : {}),
        rows: s.rows,
        cols: s.cols,
        maxRow: s.maxRow,
        maxCol: s.maxCol,
      } satisfies SheetModel,
      ...(widths && widths.size > 0 ? { colWidths: widths } : {}),
      ...(s.freeze ? { freeze: { ...s.freeze } } : {}),
    }
  })
  return { sheets }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Полезная нагрузка → буфер капсулы .nvgridx (свежие соль и IV). */
export async function encryptSnapshot(
  payload: SnapshotPayload,
  passphrase: string,
): Promise<ArrayBuffer> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const plain = new TextEncoder().encode(JSON.stringify(payload))
  const header = new Uint8Array(HEADER_BYTES)
  header.set(MAGIC, 0)
  header.set(salt, 8)
  header.set(iv, 24)
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource },
    key,
    plain,
  )
  const out = new Uint8Array(HEADER_BYTES + sealed.byteLength)
  out.set(header, 0)
  out.set(new Uint8Array(sealed), HEADER_BYTES)
  return out.buffer
}

/** Буфер .nvgridx → полезная нагрузка; ошибка — человеческим текстом. */
export async function decryptSnapshot(
  buffer: ArrayBuffer,
  passphrase: string,
): Promise<SnapshotPayload> {
  if (!isSnapshotBuffer(buffer)) {
    throw new Error('Это не файл-снапшот NovaGrid (.nvgridx) — файл повреждён или создан не NovaGrid')
  }
  const bytes = new Uint8Array(buffer)
  const salt = bytes.slice(8, 8 + SALT_BYTES)
  const iv = bytes.slice(24, 24 + IV_BYTES)
  const header = bytes.slice(0, HEADER_BYTES)
  const key = await deriveKey(passphrase, salt)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource },
      key,
      bytes.slice(HEADER_BYTES),
    )
  } catch {
    // GCM не различает неверный ключ и битый шифротекст — честно говорим оба
    throw new Error('Неверная парольная фраза или файл повреждён')
  }
  return JSON.parse(new TextDecoder().decode(plain)) as SnapshotPayload
}
