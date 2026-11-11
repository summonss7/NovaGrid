import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { cellKey, getCell } from '../core/sheet'
import { docTextToSheets, docToSheets, docxToSheets } from './docx'

/* ── сборка .docx фикстур: минимальный пакет OOXML ───────────────────── */

async function docxBuffer(documentXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file('word/document.xml', documentXml)
  const out = await zip.generateAsync({ type: 'uint8array' })
  return out.slice().buffer
}

const P = (text: string): string =>
  `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const TC = (text: string, extra = ''): string =>
  `<w:tc><w:tcPr>${extra}</w:tcPr>${P(text)}</w:tc>`
const TR = (...cells: string[]): string => `<w:tr>${cells.join('')}</w:tr>`
const TBL = (...rows: string[]): string => `<w:tbl>${rows.join('')}</w:tbl>`
const BODY = (inner: string): string =>
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`

describe('docx: чтение .docx (таблицы и текст)', () => {
  it('таблица → лист «Таблица 1», текст вне таблиц → лист «Текст»', async () => {
    const buf = await docxBuffer(
      BODY(P('Заголовок письма') + TBL(TR(TC('A'), TC('B')), TR(TC('1'), TC('2'))) + P('Подпись')),
    )
    const sheets = await docxToSheets(buf)
    expect(sheets.map((s) => s.name)).toEqual(['Текст', 'Таблица 1'])
    expect(getCell(sheets[0].sheet, 0, 0)).toBe('Заголовок письма')
    expect(getCell(sheets[0].sheet, 1, 0)).toBe('Подпись')
    const t = sheets[1].sheet
    expect(getCell(t, 0, 0)).toBe('A')
    expect(getCell(t, 0, 1)).toBe('B')
    expect(getCell(t, 1, 0)).toBe('1')
    expect(getCell(t, 1, 1)).toBe('2')
    expect(t.maxRow).toBe(1)
    expect(t.maxCol).toBe(1)
  })

  it('две таблицы → два листа по порядку, пустой документ → лист «Документ»', async () => {
    const two = await docxToSheets(
      await docxBuffer(BODY(TBL(TR(TC('x'))) + TBL(TR(TC('y'))))),
    )
    expect(two.map((s) => s.name)).toEqual(['Таблица 1', 'Таблица 2'])

    const empty = await docxToSheets(await docxBuffer(BODY(P('') + P(' '))))
    expect(empty.map((s) => s.name)).toEqual(['Документ'])
    expect(empty[0].sheet.cells.size).toBe(0)
  })

  it('gridSpan и vMerge → объединения MergeRect', async () => {
    // шапка на 2 колонки (gridSpan=2), вертикальное объединение в колонке A
    const xml = TBL(
      TR(TC('Шапка', '<w:gridSpan w:val="2"/>'), TC('C')),
      TR(TC('v', '<w:vMerge w:val="restart"/>'), TC('r1')),
      TR(TC('', '<w:vMerge/>'), TC('r2')),
    )
    const sheets = await docxToSheets(await docxBuffer(BODY(xml)))
    const t = sheets[0].sheet
    // шапка занимает (0,0)-(0,1), ячейка «C» из-за спана съехала в колонку 2
    expect(getCell(t, 0, 0)).toBe('Шапка')
    expect(getCell(t, 0, 2)).toBe('C')
    expect(getCell(t, 1, 0)).toBe('v')
    expect(getCell(t, 1, 1)).toBe('r1')
    expect(getCell(t, 2, 1)).toBe('r2')
    expect(t.merges).toContainEqual({ r1: 0, c1: 0, r2: 0, c2: 1 })
    expect(t.merges).toContainEqual({ r1: 1, c1: 0, r2: 2, c2: 0 })
  })

  it('стили ячеек: жирность, заливка, выравнивание, цвет, размер', async () => {
    const head =
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:b/><w:i/><w:u/><w:sz w:val="28"/><w:color w:val="E8481C"/></w:rPr>' +
      '<w:t>Шапка</w:t></w:r></w:p>'
    const xml = TBL(
      TR(`<w:tc><w:tcPr><w:shd w:fill="E8F8EC"/></w:tcPr>${head}</w:tc>`, TC('тело')),
    )
    const sheets = await docxToSheets(await docxBuffer(BODY(xml)))
    expect(sheets[0].sheet.styles.get(cellKey(0, 0))).toEqual({
      bold: true,
      italic: true,
      underline: true,
      size: 14,
      fg: 'E8481C',
      bg: 'E8F8EC',
      align: 'center',
    })
    expect(sheets[0].sheet.styles.get(cellKey(0, 1))).toBeUndefined()
  })

  it('несколько абзацев в ячейке и таб/перенос внутри runs', async () => {
    const cell = `<w:tc>${P('строка 1')}${P('строка 2')}<w:p><w:r><w:t>с</w:t><w:tab/><w:t>табом</w:t></w:r></w:p></w:tc>`
    const sheets = await docxToSheets(await docxBuffer(BODY(TBL(TR(cell)))))
    expect(getCell(sheets[0].sheet, 0, 0)).toBe('строка 1\nстрока 2\nс\tтабом')
  })

  it('битый zip → понятная ошибка', async () => {
    await expect(docxToSheets(new TextEncoder().encode('не zip').buffer)).rejects.toThrow(
      /Не удалось прочитать \.docx/,
    )
  })
})

/* ── сборка .doc фикстуры: минимальный OLE + FIB + piece table ───────── */

/** Текст → куски WordDocument/1Table для простого односегментного .doc. */
function docStreams(mainText: string): { word: Uint8Array; table: Uint8Array } {
  const TEXT_AT = 0x800
  const textBytes = new Uint8Array(mainText.length * 2)
  const tv = new DataView(textBytes.buffer)
  for (let i = 0; i < mainText.length; i += 1) tv.setUint16(i * 2, mainText.charCodeAt(i), true)

  // WordDocument ≥ 4096 — иначе поток по спецификации CFB живёт в miniFAT
  const word = new Uint8Array(Math.max(4096, TEXT_AT + textBytes.length))
  const wv = new DataView(word.buffer)
  wv.setUint16(0x00, 0xa5ec, true) // wIdent
  wv.setUint16(0x0a, 0x0200, true) // fWhichTblStm → 1Table
  wv.setUint32(0x50, mainText.length, true) // ccpText (fibRgLw97)
  // CLX в 1Table: Pcdt(0x02, lcb) + PlcPcd: CP[0..n] + PCD(fc*2 — юникод)
  const plc = new Uint8Array(4 * 2 + 8)
  const pv = new DataView(plc.buffer)
  pv.setUint32(0, 0, true)
  pv.setUint32(4, mainText.length, true)
  pv.setUint32(8 + 2, TEXT_AT, true) // PCD.fc — байтовое смещение (бит 30 чист — юникод)
  const table = new Uint8Array(5 + plc.length)
  table[0] = 2
  new DataView(table.buffer).setUint32(1, plc.length, true)
  table.set(plc, 5)
  wv.setUint32(0x1a2, 0, true) // fcClx — CLX в начале 1Table
  wv.setUint32(0x1a6, table.length, true)
  word.set(textBytes, TEXT_AT)
  return { word, table: table.length >= 4096 ? table : pad4096(table) }
}

function pad4096(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4096)
  out.set(bytes)
  return out
}

/** OLE v3 (512-байтные сектора): header + FAT + каталог + два потока. */
function oleBuffer(streams: Record<string, Uint8Array>): ArrayBuffer {
  const SECT = 512
  // сектора: 0=FAT, 1=каталог, дальше потоки кусками по SECT
  const parts: Uint8Array[] = [new Uint8Array(SECT), new Uint8Array(SECT)]
  const dirEntries: { name: string; start: number; size: number }[] = []
  for (const [name, bytes] of Object.entries(streams)) {
    const start = parts.length
    const nSec = Math.max(1, Math.ceil(bytes.length / SECT))
    for (let i = 0; i < nSec; i += 1) {
      const sec = new Uint8Array(SECT)
      sec.set(bytes.subarray(i * SECT, Math.min((i + 1) * SECT, bytes.length)))
      parts.push(sec)
    }
    dirEntries.push({ name, start, size: bytes.length })
  }
  const fat = new DataView(parts[0].buffer)
  const END = 0xfffffffe
  const FREE = 0xffffffff
  fat.setUint32(0, 0xfffffffd, true) // сектор 0 — сам FAT
  fat.setUint32(4, END, true) // каталог
  let at = 2
  for (let i = 0; i < dirEntries.length; i += 1) {
    const nSec = Math.max(1, Math.ceil(dirEntries[i].size / SECT))
    for (let k = 0; k < nSec; k += 1)
      fat.setUint32((at + k) * 4, k + 1 === nSec ? END : at + k + 1, true)
    at += nSec
  }
  for (let i = at; i < SECT / 4; i += 1) fat.setUint32(i * 4, FREE, true)
  // каталог: Root Entry (child → первый поток), потоки — правые соседи
  const dir = new DataView(parts[1].buffer)
  const NONE = 0xffffffff
  const entry = (idx: number, name: string, type: number, start: number, size: number, right: number, child: number) => {
    const base = idx * 128
    for (let i = 0; i < name.length; i += 1) dir.setUint16(base + i * 2, name.charCodeAt(i), true)
    dir.setUint16(base + 64, name.length * 2 + 2, true)
    dir.setUint8(base + 66, type)
    dir.setUint8(base + 67, 1)
    dir.setUint32(base + 68, NONE, true) // left
    dir.setUint32(base + 72, right, true)
    dir.setUint32(base + 76, child, true)
    dir.setUint32(base + 116, start, true)
    dir.setUint32(base + 120, size, true)
  }
  entry(0, 'Root Entry', 5, 0, 0, NONE, 1)
  dirEntries.forEach((e, i) => entry(i + 1, e.name, 2, e.start, e.size, i + 2 <= dirEntries.length ? i + 2 : NONE, NONE))
  // заголовок OLE
  const header = new Uint8Array(SECT)
  const hv = new DataView(header.buffer)
  const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  SIG.forEach((b, i) => (header[i] = b))
  hv.setUint16(26, 3, true) // major v3 → 512-байтные сектора
  hv.setUint16(30, 9, true) // sectorShift
  hv.setUint16(32, 6, true) // miniSectorShift
  hv.setUint32(40, 1, true) // один FAT-сектор
  hv.setUint32(44, 1, true) // каталог в секторе 1
  hv.setUint32(52, 4096, true) // miniCutoff
  hv.setUint32(56, END, true) // miniFAT нет
  hv.setUint32(64, END, true) // DIFAT-цепочки нет
  hv.setUint32(72, 0, true) // DIFAT[0] = сектор 0
  for (let i = 1; i < 109; i += 1) hv.setUint32(72 + i * 4, FREE, true)
  const total = header.length + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of [header, ...parts]) {
    out.set(p, off)
    off += p.length
  }
  return out.buffer
}

function docBuffer(text: string): ArrayBuffer {
  const { word, table } = docStreams(text)
  return oleBuffer({ WordDocument: word, '1Table': table })
}

describe('doc: чтение .doc (OLE + piece table + маркеры)', () => {
  it('таблица по маркерам 0x07 и текст → листы «Текст»/«Таблица 1»', async () => {
    const text = 'Лид документа\rТ1\x07Т2\x07\x07\r21\x0722\x07\x07\rХвост\r'
    const sheets = docToSheets(docBuffer(text))
    expect(sheets.map((s) => s.name)).toEqual(['Текст', 'Таблица 1'])
    expect(getCell(sheets[0].sheet, 0, 0)).toBe('Лид документа')
    expect(getCell(sheets[0].sheet, 1, 0)).toBe('Хвост')
    const t = sheets[1].sheet
    expect(getCell(t, 0, 0)).toBe('Т1')
    expect(getCell(t, 0, 1)).toBe('Т2')
    expect(getCell(t, 1, 0)).toBe('21')
    expect(getCell(t, 1, 1)).toBe('22')
  })

  it('без таблиц — один текстовый лист; пустой текст — лист «Документ»', () => {
    const only = docToSheets(docBuffer('Первый\rВторой\r'))
    expect(only.map((s) => s.name)).toEqual(['Текст'])
    expect(only[0].sheet.cells.size).toBe(2)
    const empty = docToSheets(docBuffer(''))
    expect(empty.map((s) => s.name)).toEqual(['Документ'])
  })

  it('кириллица и cp1252-символы читаются корректно', () => {
    const sheets = docToSheets(docBuffer('Сумма — 12\u20ac\r'))
    expect(getCell(sheets[0].sheet, 0, 0)).toBe('Сумма — 12\u20ac')
  })

  it('не-OLE файл → понятная ошибка', () => {
    expect(() => docToSheets(new TextEncoder().encode('plain text').buffer)).toThrow(/не OLE/)
  })

  it('docTextToSheets: пустые ячейки и маркер конца строки', () => {
    const sheets = docTextToSheets('a\rb\x07\x07\r\x07x\x07\x07')
    // «a» — текст вне таблицы; «b␇␇» → строка [b]; «␇x␇␇» → строка ['', x]
    expect(sheets.map((s) => s.name)).toEqual(['Текст', 'Таблица 1'])
    const t = sheets[1].sheet
    expect(getCell(t, 0, 0)).toBe('b')
    expect(getCell(t, 1, 0)).toBe('')
    expect(getCell(t, 1, 1)).toBe('x')
  })
})
