/*
 * Файловые действия главного потока (Этап 2.3): открытие (File System Access
 * с fallback на input/drag&drop), запись в открытый хэндл, скачивание.
 * UI-решения (диалоги, тосты) живут в app/App — здесь только механика.
 */

import { gridStore, type FileFormat } from '../core/store'
import { readFileBuffer, writeCsv, writeXlsx } from './client'
import type { SheetWire } from './excel'
import { bookToSnapshot, encryptSnapshot } from './snapshot'

export type { SheetWire }

export function extToFormat(name: string): FileFormat | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (ext === 'xls') return 'xls'
  if (ext === 'ods') return 'ods'
  return null
}

/** File → модель книги (парсинг в IO-воркере) → стор. */
export async function readBookFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer()
  const format = extToFormat(file.name)
  if (!format) {
    throw new Error(
      `Формат «${file.name.split('.').pop()}» не поддерживается: откройте .xlsx, .xls, .ods, .csv или .tsv`,
    )
  }
  const { sheets, csvDelimiter } = await readFileBuffer(file.name, buffer)
  gridStore
    .getState()
    .loadBook({ sheets }, { fileName: file.name, fileFormat: format, csvDelimiter })
}

/** Фикстура стартового экрана: fetch → тот же конвейер открытия. */
export async function openFixture(url: string, name: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Файл недоступен: ${url} (${res.status})`)
  const buffer = await res.arrayBuffer()
  const format = extToFormat(name)
  if (!format) throw new Error(`Неизвестный формат фикстуры: ${name}`)
  const { sheets, csvDelimiter } = await readFileBuffer(name, buffer)
  gridStore.getState().loadBook({ sheets }, { fileName: name, fileFormat: format, csvDelimiter })
}

/** Буфер книги по формату (csv — активный лист). */
export async function buildBookBuffer(
  format: 'xlsx' | 'csv',
  delimiter: string,
): Promise<ArrayBuffer> {
  const st = gridStore.getState()
  if (format === 'csv') return writeCsv(st.sheet, delimiter)
  return writeXlsx(st.tabs.map((t) => ({ name: t.name, sheet: t.sheet })))
}

/** Капсула .nvgridx всей книги (Этап 7.6): снапшот → AES-GCM по фразе. */
export async function buildSnapshotBuffer(passphrase: string): Promise<ArrayBuffer> {
  const st = gridStore.getState()
  return encryptSnapshot(
    bookToSnapshot(st.tabs, { fileName: st.fileName, csvDelimiter: st.csvDelimiter }),
    passphrase,
  )
}

/** Прямая запись в открытый файл (Chromium-десктоп, CONCEPT Ф1). */
export async function writeToHandle(
  handle: FileSystemFileHandle,
  buffer: ArrayBuffer,
): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(buffer)
  await writable.close()
}

/** Fallback-сохранение: скачивание файла (iOS/Android/Firefox и e2e). */
export function downloadBuffer(name: string, buffer: ArrayBuffer, mime: string): void {
  const blob = new Blob([buffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function xlsxMime(): string {
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

export function csvMime(): string {
  return 'text/csv'
}

export function isFsaAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/** Результат пикера FSA: файл + хэндл для будущих Ctrl+S и «Недавних». */
export interface PickedFile {
  file: File
  handle: FileSystemFileHandle
}

/** Открытие через пикер FSA: файл и хэндл (хэндл в стор ставит App после загрузки). */
export async function pickOpenFile(): Promise<PickedFile | null> {
  if (typeof window !== 'undefined' && typeof window.showOpenFilePicker !== 'function') return null
  try {
    const [handle] = await window.showOpenFilePicker!({
      types: [
        {
          description: 'Таблицы',
          accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'],
            'application/vnd.ms-excel': ['.xls'],
            'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
            'text/csv': ['.csv', '.tsv'],
            'application/octet-stream': ['.nvgridx'],
          },
        },
      ],
    })
    return { file: await handle.getFile(), handle }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null // отмена пикера
    throw err
  }
}

/** Права на повторное чтение FSA-хэндла: query → request (клик в «Недавних» — жест). */
export async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as FileSystemFileHandle & {
    queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>
    requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>
  }
  try {
    if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) === 'granted') return true
    if (h.requestPermission) return (await h.requestPermission({ mode: 'read' })) === 'granted'
    return true // API прав нет — просто пробуем getFile
  } catch {
    return false
  }
}
