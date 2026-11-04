/*
 * Клиент IO-воркера (главный поток): один воркер на приложение, запросы по id.
 * Воркер создаётся лениво — бандл с ExcelJS/SheetJS не грузится, пока
 * пользователь не открыл/не сохранил файл.
 */

import type { SheetModel } from '../core/sheet'
import type { SheetWire } from './excel'
import type { IoRequest, IoResponse } from './ioWorker'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: IoResponse) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./ioWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<IoResponse>) => {
      const res = event.data
      const p = pending.get(res.id)
      if (!p) return
      pending.delete(res.id)
      if (res.ok) p.resolve(res)
      else p.reject(new Error(res.error))
    }
    worker.onerror = (event) => {
      const err = new Error(`IO-воркер упал: ${event.message}`)
      for (const p of pending.values()) p.reject(err)
      pending.clear()
    }
  }
  return worker
}

/** Omit по объединению должен распределяться по вариантам, иначе схлопнется до общих ключей */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

function call<T extends IoResponse>(
  req: DistributiveOmit<IoRequest, 'id'>,
  transfer?: Transferable[],
): Promise<T> {
  const id = (seq += 1)
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: IoResponse) => void, reject })
    getWorker().postMessage({ ...req, id } as IoRequest, transfer ?? [])
  })
}

/** Прочитать файл (по расширению) → вкладки книги + метаданные CSV. */
export async function readFileBuffer(
  name: string,
  buffer: ArrayBuffer,
): Promise<{ sheets: SheetWire[]; csvDelimiter?: string }> {
  const res = await call<IoResponse & { kind: 'read'; ok: true; sheets: SheetWire[] }>(
    { kind: 'read', name, buffer },
    [buffer],
  )
  return { sheets: res.sheets, csvDelimiter: res.csvDelimiter }
}

export function writeXlsx(sheets: readonly SheetWire[]): Promise<ArrayBuffer> {
  return call<IoResponse & { kind: 'write'; ok: true; buffer: ArrayBuffer }>({
    kind: 'write-xlsx',
    sheets: [...sheets],
  }).then((res) => res.buffer)
}

/** Запись .ods (novagrid-050): собственный writer в IO-воркере. */
export function writeOds(sheets: readonly SheetWire[]): Promise<ArrayBuffer> {
  return call<IoResponse & { kind: 'write'; ok: true; buffer: ArrayBuffer }>({
    kind: 'write-ods',
    sheets: [...sheets],
  }).then((res) => res.buffer)
}

export function writeCsv(sheet: SheetModel, delimiter: string): Promise<ArrayBuffer> {
  return call<IoResponse & { kind: 'write'; ok: true; buffer: ArrayBuffer }>({
    kind: 'write-csv',
    sheet,
    delimiter,
  }).then((res) => res.buffer)
}
