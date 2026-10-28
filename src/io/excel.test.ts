import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { cellKey, createSheet, getCell, withCell } from '../core/sheet'
import { cellText, cellIsFrozen, recalcSheet } from '../formula/engine'
import { type SheetWire, odsToSheets, sheetsToXlsx, xlsToSheets, xlsxToSheets } from './excel'

/* exceljs в Node отдаёт Buffer (view над пулом) — копируем в чистый ArrayBuffer */
async function xlsxRoundBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const view = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array
  return view.slice().buffer
}

describe('excel: чтение .xlsx (значения и кэш формул)', () => {
  it('строки, числа, булевы, формула → кэш результата, два листа', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Данные')
    ws.addRow(['Фамилия', 'Сумма'])
    ws.addRow(['Иванов', 10000])
    ws.addRow(['Петров', 12500])
    ws.getCell(4, 1).value = 'Итог'
    ws.getCell(4, 2).value = { formula: 'SUM(B2:B3)', result: 22500 }
    ws.getCell(5, 1).value = true
    const ref = wb.addWorksheet('Справка')
    ref.addRow(['Текст', 42])

    const sheets = await xlsxToSheets(await xlsxRoundBuffer(wb))
    expect(sheets.map((s) => s.name)).toEqual(['Данные', 'Справка'])
    const data = sheets[0].sheet
    expect(getCell(data, 0, 0)).toBe('Фамилия')
    expect(getCell(data, 1, 1)).toBe('10000')
    // формула хранится текстом (строка формул, Этап 4.3), результат Excel —
    // в кэше; SUM поддерживается — движок пересчитает его сам (4.6)
    expect(getCell(data, 3, 1)).toBe('=SUM(B2:B3)')
    expect(data.formulaCache?.get(cellKey(3, 1))).toBe('22500')
    recalcSheet(data)
    expect(cellText(data, 3, 1)).toBe('22500')
    expect(cellIsFrozen(data, 3, 1)).toBe(false)
    expect(getCell(data, 4, 0)).toBe('ИСТИНА')
    expect(getCell(data, 4, 1)).toBe('') // пусто не хранится
    expect(sheets[1].sheet.cells.get(cellKey(0, 1))).toBe('42')
  })

  it('стили читаются: жирность, заливка, выравнивание, цвет текста', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addRow(['Шапка', 'Обычная'])
    const head = ws.getCell(1, 1)
    head.font = { bold: true, color: { argb: 'FFE8481C' } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F8EC' } }
    head.alignment = { horizontal: 'center' }

    const sheets = await xlsxToSheets(await xlsxRoundBuffer(wb))
    const style = sheets[0].sheet.styles.get(cellKey(0, 0))
    expect(style).toEqual({ bold: true, bg: 'E8F8EC', fg: 'E8481C', align: 'center' })
    expect(sheets[0].sheet.styles.get(cellKey(0, 1))).toBeUndefined()
  })

  it('начертания novagrid-039 читаются: курсив, подчёркивание, размер, Montserrat', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('S')
    ws.addRow(['Дисплей', 'Кламп', 'Обычная'])
    const a = ws.getCell(1, 1)
    a.font = { italic: true, underline: true, size: 14, name: 'Montserrat' }
    ws.getCell(1, 2).font = { size: 40 } // больше клетки грида — клампится

    const sheets = await xlsxToSheets(await xlsxRoundBuffer(wb))
    expect(sheets[0].sheet.styles.get(cellKey(0, 0))).toEqual({
      italic: true,
      underline: true,
      size: 14,
      font: 'display',
    })
    expect(sheets[0].sheet.styles.get(cellKey(0, 1))).toEqual({ size: 16 })
    expect(sheets[0].sheet.styles.get(cellKey(0, 2))).toBeUndefined()
  })
})

describe('excel: запись .xlsx со стилями', () => {
  it('roundtrip модель → xlsx → модель без потерь значений и стилей', async () => {
    let sheet = createSheet()
    const styled = [
      [0, 0, 'Фамилия'],
      [0, 1, 'Сумма'],
    ] as const
    for (const [r, c, v] of styled) sheet = withCell(sheet, r, c, v)
    sheet = withCell(sheet, 1, 0, 'Иванов')
    sheet = withCell(sheet, 1, 1, '10000')
    sheet = withCell(sheet, 2, 0, '12.5')
    sheet.styles.set(cellKey(0, 0), { bold: true, bg: 'E8F8EC' })
    sheet.styles.set(cellKey(0, 1), { bold: true, align: 'center' })

    const buffer = await sheetsToXlsx([{ name: 'Отчёт', sheet }])
    const back = await xlsxToSheets(buffer)
    expect(back).toHaveLength(1)
    expect(back[0].name).toBe('Отчёт')
    const s = back[0].sheet
    expect(getCell(s, 1, 0)).toBe('Иванов')
    expect(getCell(s, 1, 1)).toBe('10000')
    expect(getCell(s, 2, 0)).toBe('12.5')
    expect(s.styles.get(cellKey(0, 0))).toEqual({ bold: true, bg: 'E8F8EC' })
    expect(s.styles.get(cellKey(0, 1))).toEqual({ bold: true, align: 'center' })
  })

  it('roundtrip новых полей стиля: курсив, подчёркивание, шрифт, размер (novagrid-039)', async () => {
    let sheet = createSheet()
    sheet = withCell(sheet, 0, 0, 'Заголовок')
    sheet = withCell(sheet, 1, 0, 'Текст')
    sheet.styles.set(cellKey(0, 0), {
      italic: true,
      underline: true,
      font: 'display',
      size: 14,
      fg: 'C00000',
    })

    const buffer = await sheetsToXlsx([{ name: 'L', sheet }])
    const back = await xlsxToSheets(buffer)
    expect(back[0].sheet.styles.get(cellKey(0, 0))).toEqual({
      italic: true,
      underline: true,
      font: 'display',
      size: 14,
      fg: 'C00000',
    })
    expect(back[0].sheet.styles.get(cellKey(1, 0))).toBeUndefined()
  })

  it('числа остаются числами (Excel распознаёт)', async () => {
    let sheet = createSheet()
    sheet = withCell(sheet, 0, 0, '10000')
    sheet = withCell(sheet, 1, 0, 'Иванов')
    const buffer = await sheetsToXlsx([{ name: 'L', sheet }])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.getWorksheet('L')!.getCell('A1').value).toBe(10000)
    expect(wb.getWorksheet('L')!.getCell('A2').value).toBe('Иванов')
  })
})

describe('excel: чтение .ods (свой парсер novagrid-040)', () => {
  it('несколько листов → вкладки; кириллица/числа/даты-ISO; пустые не хранятся', async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(
      [
        ['Фамилия', 'Сумма', 'Дата'],
        ['Иванов', 10000, new Date(Date.UTC(2026, 8, 1))],
        [null, 12500, null], // пустые ячейки в строке
        ['Петров', '', new Date(Date.UTC(2026, 8, 3, 14, 30))],
      ],
      { cellDates: true },
    )
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1')
    const ref = XLSX.utils.aoa_to_sheet([['Справка'], [true, 42]])
    XLSX.utils.book_append_sheet(wb, ref, 'Лист2')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'ods' }) as Buffer
    const arrayBuf = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer

    const sheets: SheetWire[] = await odsToSheets(arrayBuf)
    expect(sheets.map((s) => s.name)).toEqual(['Лист1', 'Лист2'])
    const data = sheets[0].sheet
    expect(getCell(data, 0, 0)).toBe('Фамилия')
    expect(getCell(data, 1, 1)).toBe('10000')
    expect(getCell(data, 1, 2)).toBe('2026-09-01') // дата — ISO, как у .xlsx
    expect(getCell(data, 3, 2)).toBe('2026-09-03 14:30') // дата+время
    expect(getCell(data, 2, 0)).toBe('') // пустые ячейки не хранятся
    expect(getCell(data, 3, 1)).toBe('')
    expect(data.styles.size).toBe(0) // стили ODS не переносятся
    expect(getCell(sheets[1].sheet, 1, 0)).toBe('ИСТИНА') // булевы — как в .xlsx
    expect(getCell(sheets[1].sheet, 1, 1)).toBe('42')
  })
})

describe('excel: чтение .xls (SheetJS, BIFF8)', () => {
  it('значения читаются как отображаемые строки', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Фамилия', 'Сумма'],
      ['Иванов', '10000'],
      ['Петров', '12500'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
    const arrayBuf = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer

    const sheets = xlsToSheets(arrayBuf)
    expect(sheets.map((s) => s.name)).toEqual(['Лист1'])
    expect(getCell(sheets[0].sheet, 0, 0)).toBe('Фамилия')
    expect(getCell(sheets[0].sheet, 1, 1)).toBe('10000')
    expect(getCell(sheets[0].sheet, 2, 0)).toBe('Петров')
  })

  it('пустая строка внутри листа не сдвигает данные вверх (novagrid-040)', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([['первая'], [], ['третья']])
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer
    const arrayBuf = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer

    const sheets = xlsToSheets(arrayBuf)
    expect(getCell(sheets[0].sheet, 0, 0)).toBe('первая')
    expect(getCell(sheets[0].sheet, 1, 0)).toBe('')
    expect(getCell(sheets[0].sheet, 2, 0)).toBe('третья')
  })
})
