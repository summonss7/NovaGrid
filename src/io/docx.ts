/*
 * Чтение документов Word (novagrid-068): .docx и .doc → книга листов-таблиц.
 * Концепция как у остальных импортёров: документ — та же сетка, только без
 * формул (в Word их и нет) — «Таблица N» на каждую таблицу документа, весь
 * текст вне таблиц — лист «Текст» (абзац = строка, колонка A). Сохранение
 * обратно в .doc/.docx не делается — формат только для открытия, «Сохранить
 * как…» конвертирует в .xlsx/.csv/.ods (как у .xls).
 *
 * .docx — zip + word/document.xml (свой разбор регэкспами, без DOM — модуль
 * живёт в IO-воркере и юнит-тестах Node, как ods.ts). Поддержаны объединения
 * (gridSpan/vMerge → MergeRect) и базовые стили ячеек (жирность/курсив/
 * подчёркивание, размер, цвет, заливка, выравнивание абзацев).
 *
 * .doc (Word 6/95/97-2003, OLE-бинарарь) — читается контейнер OLE (FAT +
 * miniFAT), из потока WordDocument берётся текст через piece table (fcClx в
 * таблице-потоке), таблицы восстанавливаются по маркерам: 0x07 — конец ячейки/
 * строки, 0x0D — конец абзаца. Геометрия объединений в .doc не читается
 * (sprm-разбор PAPX вне охвата) — значения на месте, ширина строк выравнива-
 * ния не требует. Документ с шифровкой/битой piece table → понятная ошибка
 * с советом пересохранить в .docx.
 *
 * Модуль без DOM и без зависимостей кроме JSZip (как ods.ts).
 */

import JSZip from 'jszip'
import type { MergeRect } from '../core/merges'
import {
  MIN_COLS,
  MIN_ROWS,
  cellKey,
  normalizeCellSize,
  type CellStyle,
  type SheetModel,
} from '../core/sheet'
import { sanitizeSheetName, uniqueTabName, type SheetWire } from '../core/workbook'

/* ── XML-утилиты (общие приёмы ods.ts, пространство имён Word) ───────── */

/** Сущности XML («&amp;», «&#1071;») → символы. */
function xmlDecode(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (whole, name: string) => {
    switch (name) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default: {
        const hex = name.startsWith('#x') || name.startsWith('#X')
        const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole
      }
    }
  })
}

/** Тег с пространством имён как литерал: `<w:tbl …>` (учёт атрибутов). */
const OPEN = (tag: string): RegExp => new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g')
const CLOSE = (tag: string): RegExp => new RegExp(`</${tag}\\s*>`, 'g')

/** Куски элемента верхнего уровня: `<w:tbl>…</w:tbl>` с учётом вложенности. */
function topLevelChunks(
  xml: string,
  tag: string,
): { chunk: string; start: number; end: number }[] {
  const out: { chunk: string; start: number; end: number }[] = []
  const open = OPEN(tag)
  const close = CLOSE(tag)
  let depth = 0
  let start = -1
  let o: RegExpExecArray | null = open.exec(xml)
  let c: RegExpExecArray | null = close.exec(xml)
  while (o || c) {
    // следующий токен — тот, что раньше по позиции
    if (o && (!c || o.index <= c.index)) {
      if (depth === 0) start = o.index
      depth += 1
      o = open.exec(xml)
    } else if (c) {
      depth -= 1
      if (depth === 0)
        out.push({
          chunk: xml.slice(start, c.index + c[0].length),
          start,
          end: c.index + c[0].length,
        })
      c = close.exec(xml)
    } else break
  }
  return out
}

/** Текст абзаца w:p: runs w:t склеиваются, tab/br → \t/\n, прочее выпадает. */
function paragraphText(pXml: string): string {
  return xmlDecode(
    pXml
      .replace(/<w:tab(?:\s[^>]*)?\/?>/g, '\t')
      .replace(/<w:(?:br|cr)(?:\s[^>]*)?\/>/g, '\n')
      .replace(/<[^>]*>/g, ''),
  )
}

/** Стиль ячейки-абзаца: доминирующие флаги runs + w:jc + rPr-цвет/размер. */
function paragraphStyle(pXml: string): CellStyle | undefined {
  const style: CellStyle = {}
  const runs = pXml.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? []
  const flags = (tag: string): boolean => {
    if (runs.length === 0) return false
    let have = 0
    for (const r of runs) if (new RegExp(`<${tag}(?:\\s[^>]*)?/?>`).test(r)) have += 1
    return have > 0 && have === runs.length
  }
  if (flags('w:b')) style.bold = true
  if (flags('w:i')) style.italic = true
  if (flags('w:u')) style.underline = true
  const jc = /<w:jc(?:\s[^>]*)?\sw:val="(center|right)"/.exec(pXml)
  if (jc) style.align = jc[1] === 'center' ? 'center' : 'right'
  const sz = /<w:sz(?:\s[^>]*)?\sw:val="(\d+)"/.exec(pXml)
  if (sz) style.size = normalizeCellSize(Number(sz[1]) / 2)
  const color = /<w:color(?:\s[^>]*)?\sw:val="([0-9A-Fa-f]{6})"/.exec(pXml)
  if (color) style.fg = color[1].toUpperCase()
  return Object.keys(style).length > 0 ? style : undefined
}

/** Стиль ячейки таблицы: заливка w:shd из tcPr + стили абзацев внутри. */
function cellStyle(tcXml: string): CellStyle | undefined {
  const out: CellStyle = {}
  // заливка: w:shd w:fill="RRGGBB" (не auto), из tcPr или rPr — берём первую
  const shd = /<w:shd(?:\s[^>]*)?\sw:fill="(?!auto)([0-9A-Fa-f]{6})"/.exec(tcXml)
  if (shd) out.bg = shd[1].toUpperCase()
  const paras = tcXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [tcXml]
  // доминанта по абзацам: стиль первой непустой ячейки-абзаца
  for (const p of paras) {
    const st = paragraphStyle(p)
    if (st) return { ...st, ...(out.bg ? { bg: out.bg } : {}) }
  }
  return out.bg ? out : undefined
}

/** Текст ячейки: все абзацы (включая вложенные таблицы) через \n. */
function cellText(tcXml: string): string {
  const paras = (tcXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []).map(paragraphText)
  return paras.join('\n').trim()
}

/** Ячейка строки: геометрия (gridSpan, vMerge) + текст. */
interface TcCell {
  span: number
  vMerge: 'restart' | 'continue' | null
  text: string
  style?: CellStyle
}

function rowCells(trXml: string): TcCell[] {
  return topLevelChunks(trXml, 'w:tc').map(({ chunk }) => {
    const span = Number(/<w:gridSpan(?:\s[^>]*)?\sw:val="(\d+)"/.exec(chunk)?.[1] ?? 1)
    const vm = /<w:vMerge(?:\s+w:val="(\w+)")?(?:\s[^>]*)?\/?>/.exec(chunk)
    const vMerge = vm ? (vm[1] === 'restart' ? 'restart' : 'continue') : null
    const text = cellText(chunk)
    return { span: Math.max(1, span), vMerge, text, style: cellStyle(chunk) }
  })
}

/** Таблица w:tbl → лист: строки/колонки, значения, объединения, стили. */
function tableToSheet(name: string, tblXml: string): SheetWire {
  const cells = new Map<string, string>()
  const styles = new Map<string, CellStyle>()
  const merges: MergeRect[] = []
  // открытые вертикальные объединения: колонка старта → текущий rect
  const openV = new Map<number, MergeRect>()
  let maxRow = -1
  let maxCol = -1
  topLevelChunks(tblXml, 'w:tr').forEach(({ chunk: trXml }, r) => {
    let c = 0
    for (const tc of rowCells(trXml)) {
      const width = tc.span
      if (tc.vMerge === 'continue') {
        // продолжение: растягиваем открытый rect (ключ — колонка старта)
        const rect = openV.get(c)
        if (rect) rect.r2 = Math.max(rect.r2, r)
      } else {
        if (tc.vMerge === 'restart') openV.set(c, { r1: r, c1: c, r2: r, c2: c + width - 1 })
        else openV.delete(c)
        if (tc.text !== '') {
          cells.set(cellKey(r, c), tc.text)
          if (tc.style) styles.set(cellKey(r, c), tc.style)
          maxRow = Math.max(maxRow, r)
          maxCol = Math.max(maxCol, c)
        }
      }
      if (width > 1) {
        merges.push({ r1: r, c1: c, r2: r, c2: c + width - 1 })
      }
      c += width
      maxCol = Math.max(maxCol, c - 1)
    }
  })
  // горизонтальные объединения пустых (без текста) rect'ов не имеют смысла —
  // фильтруем вырожденные, вертикальные добираем из openV
  for (const rect of openV.values()) if (rect.r2 > rect.r1) merges.push(rect)
  const sheet: SheetModel = {
    cells,
    styles,
    ...(merges.length > 0 ? { merges } : {}),
    rows: Math.max(MIN_ROWS, maxRow + 1),
    cols: Math.max(MIN_COLS, maxCol + 1),
    maxRow,
    maxCol,
  }
  return { name, sheet }
}

/** Абзацы тела вне таблиц → строки одного текстового листа. */
function textSheet(name: string, bodyXml: string): SheetWire | null {
  // вырезаем таблицы (только верхний уровень, с конца) — остаются абзацы «между»
  let text = bodyXml
  for (const ch of topLevelChunks(bodyXml, 'w:tbl').reverse())
    text = text.slice(0, ch.start) + text.slice(ch.end)
  const lines: string[] = []
  for (const m of text.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g) ?? []) {
    const s = paragraphText(m).trim()
    if (s !== '') lines.push(s)
  }
  if (lines.length === 0) return null
  const cells = new Map<string, string>()
  lines.forEach((s, i) => cells.set(cellKey(i, 0), s))
  // заголовок «Текста»: стиль первого абзаца (обычно жирный Heading)
  const first = text.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/)
  const style = first ? paragraphStyle(first[0]) : undefined
  return {
    name,
    sheet: {
      cells,
      styles: style ? new Map([[cellKey(0, 0), style]]) : new Map(),
      rows: Math.max(MIN_ROWS, lines.length),
      cols: MIN_COLS,
      maxRow: lines.length - 1,
      maxCol: 0,
    },
  }
}

/** Уникальные имена листов по образцу остальных импортёров. */
function uniqueName(used: Set<string>, base: string): string {
  let name = sanitizeSheetName(base) || base
  if (used.has(name)) name = uniqueTabName([...used], name)
  used.add(name)
  return name
}

/* ── чтение .docx ────────────────────────────────────────────────────── */

export async function docxToSheets(buffer: ArrayBuffer): Promise<SheetWire[]> {
  let docXml = ''
  try {
    const zip = await JSZip.loadAsync(buffer)
    docXml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    if (!docXml) throw new Error('нет word/document.xml')
  } catch (err) {
    throw new Error(
      `Не удалось прочитать .docx: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const body = /<w:body(?:\s[^>]*)?>([\s\S]*)<\/w:body>/.exec(docXml)?.[1] ?? docXml
  const used = new Set<string>()
  const out: SheetWire[] = []
  const text = textSheet('Текст', body)
  if (text) out.push(text)
  used.add('Текст')
  let n = 0
  for (const { chunk } of topLevelChunks(body, 'w:tbl')) {
    n += 1
    out.push(tableToSheet(uniqueName(used, `Таблица ${n}`), chunk))
  }
  if (out.length === 0) {
    // ни таблиц, ни текста — пустой документ всё равно открывается
    out.push({ name: 'Документ', sheet: emptySheet() })
  }
  return out
}

function emptySheet(): SheetModel {
  return {
    cells: new Map(),
    styles: new Map(),
    rows: MIN_ROWS,
    cols: MIN_COLS,
    maxRow: -1,
    maxCol: -1,
  }
}

/* ── чтение .doc (OLE + piece table) ─────────────────────────────────── */

/** Мини-ридер OLE/CFB: сектора FAT+miniFAT, потоки по имени. */
class OleFile {
  private readonly view: DataView
  private readonly fat: Uint32Array
  private readonly entries: Map<string, { start: number; size: number }>
  private readonly miniFat: Uint32Array
  private readonly miniStream: Uint8Array

  constructor(bytes: Uint8Array) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.view = v
    const sig = String.fromCharCode(...bytes.slice(0, 8))
    if (sig !== '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
      throw new Error('это не OLE-файл Word (.doc)')
    const ss = 1 << v.getUint16(30, true) // размер сектора (512 для v3)
    const ms = 1 << v.getUint16(32, true) // мини-сектор (64)
    // DIFAT: первые 109 в заголовке (смещение 72), дальше цепочка DIFAT-секторов
    const difat: number[] = []
    for (let i = 0; i < 109; i += 1) difat.push(v.getUint32(72 + i * 4, true))
    let next = v.getUint32(64, true)
    let guard = 0
    while (next !== 0xfffffffe && next !== 0xffffffff && guard < 10000) {
      const base = (next + 1) * ss
      for (let o = 0; o < ss - 4; o += 4) difat.push(v.getUint32(base + o, true))
      next = v.getUint32(base + ss - 4, true)
      guard += 1
    }
    // FAT целиком
    const fatWords: number[] = []
    for (const s of difat) {
      if (s === 0xffffffff) continue
      const base = (s + 1) * ss
      for (let o = 0; o < ss; o += 4) fatWords.push(v.getUint32(base + o, true))
    }
    this.fat = new Uint32Array(fatWords)
    // директория → имя → {start, size}
    this.entries = new Map()
    const dirFirst = v.getUint32(44, true)
    const dirBytes = this.chainBytes(dirFirst, this.fat, ss)
    const dirV = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength)
    for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
      const type = dirV.getUint8(off + 66)
      if (type !== 1 && type !== 2) continue
      const nameLen = dirV.getUint16(off + 64, true)
      if (nameLen < 2) continue
      let name = ''
      for (let i = 0; i < nameLen - 2; i += 2) name += String.fromCharCode(dirV.getUint16(off + i, true))
      this.entries.set(name, { start: dirV.getUint32(off + 116, true), size: Number(dirV.getBigUint64(off + 120, true)) })
    }
    // miniFAT + мини-поток корня
    const miniFatFirst = v.getUint32(56, true)
    this.miniFat =
      miniFatFirst === 0xfffffffe || miniFatFirst === 0xffffffff
        ? new Uint32Array(0)
        : new Uint32Array(this.toWords(this.chainBytes(miniFatFirst, this.fat, ss)))
    const root = this.entries.get('Root Entry')
    this.miniStream = root ? this.chainBytes(root.start, this.fat, ss, root.size) : new Uint8Array(0)
    void ms
  }

  private toWords(bytes: Uint8Array): number[] {
    const out: number[] = []
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let o = 0; o + 4 <= bytes.length; o += 4) out.push(dv.getUint32(o, true))
    return out
  }

  /** Цепочка секторов → сплошные байты (обрезка по size). */
  private chainBytes(start: number, fat: Uint32Array, ss: number, size?: number): Uint8Array {
    const parts: Uint8Array[] = []
    let s = start
    let guard = 0
    let total = 0
    while (s !== 0xfffffffe && s !== 0xffffffff && guard < 1e6) {
      const base = (s + 1) * ss
      const len = size !== undefined ? Math.min(ss, size - total) : ss
      if (len <= 0) break
      parts.push(new Uint8Array(this.view.buffer, this.view.byteOffset + base, len))
      total += len
      s = fat[s] ?? 0xfffffffe
      guard += 1
    }
    const out = new Uint8Array(total)
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }

  /** Поток по имени: обычный (FAT) или мини (< 4096 через miniFAT). */
  stream(name: string): Uint8Array {
    const e = this.entries.get(name)
    if (!e) throw new Error(`поток ${name} не найден`)
    if (e.size >= 4096) return this.chainBytes(e.start, this.fat, 512, e.size)
    // мини-поток: цепочка 64-байтных секторов внутри мини-потока корня
    const parts: number[] = []
    let s = e.start
    let guard = 0
    while (s !== 0xfffffffe && s !== 0xffffffff && guard < 1e6) {
      parts.push(s)
      s = this.miniFat[s] ?? 0xfffffffe
      guard += 1
    }
    const out = new Uint8Array(e.size)
    let at = 0
    for (const sec of parts) {
      const from = sec * 64
      const len = Math.min(64, e.size - at)
      if (len <= 0) break
      out.set(this.miniStream.subarray(from, from + len), at)
      at += len
    }
    return out
  }
}

/** .doc → текст через piece table; таблицы — по маркерам 0x07. */
export function docToSheets(buffer: ArrayBuffer): SheetWire[] {
  const ole = new OleFile(new Uint8Array(buffer))
  const wordStream = ole.stream('WordDocument')
  const fib = new DataView(wordStream.buffer, wordStream.byteOffset, wordStream.byteLength)
  const flags = fib.getUint16(0x0a, true)
  if (flags & 0x0100)
    throw new Error('документ .doc зашифрован — откройте его в Word и пересохраните как .docx')
  const ccpText = fib.getUint32(0x50, true)
  if (ccpText === 0) return [{ name: 'Документ', sheet: emptySheet() }]
  const fcClx = fib.getUint32(0x1a2, true)
  const lcbClx = fib.getUint32(0x1a6, true)
  const tableStream = ole.stream(flags & 0x0200 ? '1Table' : '0Table')
  const pieces = piecesOf(tableStream, fcClx, lcbClx)
  // текст главного потока документа по кускам piece table
  let text = ''
  for (const p of pieces) text += decodePiece(wordStream, p)
  return docTextToSheets(text.slice(0, ccpText))
}

interface Piece {
  offset: number // байт в WordDocument
  cch: number // символов
  unicode: boolean
}

/** Разбор CLX → куски текста (Pcdt: 0x02 lcb, PlcPcd: CP[] + PCD[]). */
function piecesOf(table: Uint8Array, fcClx: number, lcbClx: number): Piece[] {
  if (lcbClx === 0 || fcClx + lcbClx > table.length)
    throw new Error('структура .doc не распознана — пересохраните файл как .docx')
  const v = new DataView(table.buffer, table.byteOffset, table.byteLength)
  let at = fcClx
  const end = fcClx + lcbClx
  while (at < end) {
    const type = v.getUint8(at)
    if (type === 1) {
      at += 1 + 2 + v.getUint16(at + 1, true) // grpprl — пропускаем
    } else if (type === 2) {
      const lcb = v.getUint32(at + 1, true)
      const plcStart = at + 5
      // PlcPcd: (n+1)×u32 CP + n×8 PCD → lcb = 12n + 4
      const n = Math.floor((lcb - 4) / 12)
      if (n < 1) break
      const cps: number[] = []
      for (let i = 0; i <= n; i += 1) cps.push(v.getUint32(plcStart + i * 4, true))
      const out: Piece[] = []
      for (let i = 0; i < n; i += 1) {
        const pcd = plcStart + (n + 1) * 4 + i * 8
        const fc = v.getUint32(pcd + 2, true)
        const unicode = (fc & 0x40000000) === 0
        out.push({
          // юникод: fc — байтовое смещение; cp1252: смещение = fc/2 (бит 30)
          offset: unicode ? fc & 0x3fffffff : (fc & 0x3fffffff) >> 1,
          cch: cps[i + 1] - cps[i],
          unicode,
        })
      }
      return out
    } else break
  }
  throw new Error('piece table не найдена — пересохраните файл как .docx')
}

function decodePiece(wordStream: Uint8Array, p: Piece): string {
  let out = ''
  if (p.unicode) {
    for (let i = 0; i < p.cch; i += 1) {
      const o = p.offset + i * 2
      if (o + 2 > wordStream.length) break
      out += String.fromCharCode(new DataView(wordStream.buffer).getUint16(wordStream.byteOffset + o, true))
    }
  } else {
    for (let i = 0; i < p.cch; i += 1) {
      const o = p.offset + i
      if (o >= wordStream.length) break
      out += cp1252[wordStream[o]]
    }
  }
  return out
}

/** cp1252 → Unicode (область 0x80-0x9F отличается от latin1). */
const cp1252: string[] = (() => {
  const t: string[] = []
  for (let i = 0; i < 256; i += 1) t.push(String.fromCharCode(i))
  const high =
    '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178'
  for (let i = 0; i < 32; i += 1) t[0x80 + i] = high[i]
  return t
})()

/** Текст .doc с маркерами → листы: 0x07 — ячейки/строки, 0x0D — абзацы. */
export function docTextToSheets(text: string): SheetWire[] {
  // область таблиц: абзацы, кончающиеся маркером ячейки/строки (0x07)
  const paragraphs = text.split('\r')
  const used = new Set<string>()
  const out: SheetWire[] = []
  const textLines: string[] = []
  let rows: string[][] = []
  const flushTable = () => {
    if (rows.length === 0) return
    const cells = new Map<string, string>()
    let maxRow = -1
    let maxCol = -1
    rows.forEach((fields, r) =>
      fields.forEach((v, c) => {
        if (v !== '') {
          cells.set(cellKey(r, c), v)
          maxRow = Math.max(maxRow, r)
          maxCol = Math.max(maxCol, c)
        }
      }),
    )
    out.push({
      name: uniqueName(used, `Таблица ${out.filter((s) => s.name.startsWith('Таблица')).length + 1}`),
      sheet: {
        cells,
        styles: new Map(),
        rows: Math.max(MIN_ROWS, maxRow + 1),
        cols: Math.max(MIN_COLS, maxCol + 1),
        maxRow,
        maxCol,
      },
    })
    rows = []
  }
  // 0x0B (break) и 0x0C (page break) внутри абзаца — как перенос строки
  const CELL = String.fromCharCode(0x07)
  const ROWMARK = String.fromCharCode(0x0b)
  const PAGEMARK = String.fromCharCode(0x0c)
  const toLines = (s: string): string => s.split(ROWMARK).join('\n').split(PAGEMARK).join('\n')
  for (const para of paragraphs) {
    const isRow = para.endsWith(CELL)
    const body = isRow ? para.slice(0, -1) : para
    if (isRow) {
      // ячейки через 0x07; последний (пустой) кусок — маркер конца строки
      const fields = body.split(CELL)
      if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()
      rows.push(fields.map((f) => toLines(f).trim()))
    } else {
      flushTable()
      const s = toLines(body).trim()
      if (s !== '') textLines.push(s)
    }
  }
  flushTable()
  if (out.length === 0 && textLines.length === 0) return [{ name: 'Документ', sheet: emptySheet() }]
  if (textLines.length > 0) {
    const cells = new Map<string, string>()
    textLines.forEach((s, i) => cells.set(cellKey(i, 0), s))
    out.unshift({
      name: sanitizeSheetName('Текст') || 'Текст',
      sheet: {
        cells,
        styles: new Map(),
        rows: Math.max(MIN_ROWS, textLines.length),
        cols: MIN_COLS,
        maxRow: textLines.length - 1,
        maxCol: 0,
      },
    })
  }
  return out
}
