/*
 * Модель книги (Этап 2, ARCHITECTURE §6): вкладки листов + метаданные файла.
 * Чистый TS без DOM. Идентификаторы вкладок стабильны при переименовании —
 * на них держится история undo (Map<tabId, History> в store).
 */

import { type SheetModel, createSheet } from './sheet'

export interface SheetTab {
  id: string
  name: string
  sheet: SheetModel
}

/** Книга для передачи через границу воркера/IndexedDB (Map клонируется структурно). */
export interface BookWire {
  sheets: { name: string; sheet: SheetModel }[]
}

let idSeq = 0

export function newTabId(): string {
  idSeq += 1
  return `t${idSeq}_${Math.random().toString(36).slice(2, 8)}`
}

export function createTab(name: string, sheet: SheetModel = createSheet()): SheetTab {
  return { id: newTabId(), name: sanitizeSheetName(name), sheet }
}

export function tabsFromWire(wire: BookWire): SheetTab[] {
  const used = new Set<string>()
  return wire.sheets.map(({ name, sheet }) => {
    let finalName = sanitizeSheetName(name)
    if (used.has(finalName.toLowerCase())) finalName = uniqueTabName([...used], finalName)
    used.add(finalName.toLowerCase())
    return { id: newTabId(), name: finalName, sheet }
  })
}

/**
 * Имя листа по правилам Excel: 1–31 символ, без \ / ? * [ ] :,
 * не пустое. Библиотеки записи (ExcelJS) бросаются на нарушение.
 */
export function sanitizeSheetName(raw: string): string {
  let name = raw
    .replace(/[\\/?*[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (name.length > 31) name = name.slice(0, 31).trim()
  return name
}

/** Свободное имя вида «Лист», «Лист (2)», «Лист (3)»… */
export function uniqueTabName(taken: readonly string[], base: string): string {
  const used = new Set(taken.map((n) => n.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

export const DEFAULT_SHEET_NAME = 'Лист 1'

/** Книга по умолчанию: один пустой «Лист 1». */
export function createTabs(): SheetTab[] {
  return [createTab(DEFAULT_SHEET_NAME)]
}
