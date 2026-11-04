/// <reference lib="webworker" />
/*
 * IO-воркер (Этап 2.1, ARCHITECTURE §4): тяжёлый парсинг/запись файлов живёт
 * вне главного потока — интерфейс не замирает на больших книгах. Протокол —
 * запрос/ответ по id; буферы передаются transfer-ом (без копий).
 */

import { csvToSheet } from './csv'
import { type SheetWire, odsToSheets, xlsToSheets, xlsxToSheets, sheetsToXlsx } from './excel'
import { sheetsToOds } from './ods'
import { sheetToCsv } from './csv'
import type { SheetModel } from '../core/sheet'

export type IoRequest =
  | { id: number; kind: 'read'; name: string; buffer: ArrayBuffer }
  | { id: number; kind: 'write-xlsx'; sheets: SheetWire[] }
  | { id: number; kind: 'write-ods'; sheets: SheetWire[] }
  | { id: number; kind: 'write-csv'; sheet: SheetModel; delimiter: string }

export type IoResponse =
  | { id: number; ok: true; kind: 'read'; sheets: SheetWire[]; csvDelimiter?: string }
  | { id: number; ok: true; kind: 'write'; buffer: ArrayBuffer }
  | { id: number; ok: false; error: string }

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

async function handle(msg: IoRequest): Promise<IoResponse> {
  if (msg.kind === 'read') {
    const ext = extOf(msg.name)
    if (ext === 'csv' || ext === 'tsv') {
      const { sheet, delimiter } = csvToSheet(new Uint8Array(msg.buffer), ext)
      const name = msg.name.replace(/\.(csv|tsv)$/i, '') || 'CSV'
      return {
        id: msg.id,
        ok: true,
        kind: 'read',
        sheets: [{ name, sheet }],
        csvDelimiter: delimiter,
      }
    }
    if (ext === 'xls') {
      return { id: msg.id, ok: true, kind: 'read', sheets: xlsToSheets(msg.buffer) }
    }
    if (ext === 'ods') {
      return { id: msg.id, ok: true, kind: 'read', sheets: await odsToSheets(msg.buffer) }
    }
    // .xlsx / .xlsm и всё zip-подобное — ExcelJS
    return { id: msg.id, ok: true, kind: 'read', sheets: await xlsxToSheets(msg.buffer) }
  }
  if (msg.kind === 'write-xlsx') {
    const buffer = await sheetsToXlsx(msg.sheets)
    return { id: msg.id, ok: true, kind: 'write', buffer }
  }
  if (msg.kind === 'write-ods') {
    const buffer = await sheetsToOds(msg.sheets)
    return { id: msg.id, ok: true, kind: 'write', buffer }
  }
  const text = sheetToCsv(msg.sheet, msg.delimiter)
  return { id: msg.id, ok: true, kind: 'write', buffer: new TextEncoder().encode(text).buffer }
}

self.onmessage = (event: MessageEvent<IoRequest>) => {
  void handle(event.data)
    .then((res) => {
      const post = self.postMessage.bind(self) as (m: IoResponse, t?: Transferable[]) => void
      if (res.ok && res.kind === 'write') {
        try {
          post(res, [res.buffer])
          return
        } catch {
          // буфер вдруг нетрансперабелен — отправим копией, это дешевле молчания
        }
      }
      post(res)
    })
    .catch((err: unknown) => {
      const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      const res: IoResponse = { id: event.data.id, ok: false, error }
      ;(self as unknown as Worker).postMessage(res)
    })
}
