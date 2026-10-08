/*
 * Генератор фикстур Этапа 2.5 (ARCHITECTURE §7): демо-книга сценария ТЗ
 * (фамилии + суммы; ровно 132 строки «Иванов + 10 000» под сценарий Ф3/Ф4
 * из ТЗ) и стресс-файл 100k строк для проверки скорости/виртуализации.
 *
 * Запуск: node scripts/make-fixtures.mjs  (после npm install)
 * Файлы складываются в public/fixtures/ — они же открываются карточками
 * стартового экрана и e2e-тестами.
 */

import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'fixtures')
mkdirSync(outDir, { recursive: true })

// детерминированный ГПСЧ — фикстуры воспроизводимы бит-в-бит
let seed = 20261008
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

/* ── демо-книга сценария ТЗ ─────────────────────────────────────────── */

const SURNAMES = [
  'Петров',
  'Сидоров',
  'Кузнецова',
  'Смирнов',
  'Волкова',
  'Николаев',
  'Морозова',
  'Козлов',
]
const DEPARTMENTS = ['Продажи', 'Логистика', 'Бухгалтерия', 'Снабжение']
const AMOUNTS = [4200, 5600, 7300, 8000, 8500, 9800, 11200, 12500, 13800, 15400, 16800, 17300]
const dateOf = (i) => {
  const d = new Date(Date.UTC(2026, 7, 1 + (i % 45)))
  return d.toISOString().slice(0, 10)
}

function buildDemoRows() {
  const rows = []
  // ровно 132 строки «Иванов + 10 000» — целевой фильтр сценария ТЗ (Этап 3)
  for (let i = 0; i < 132; i++) {
    rows.push(['Иванов', pick(DEPARTMENTS), 10000, dateOf(i)])
  }
  // Иванов с другими суммами — чтобы фильтр «Иванов» не совпадал с «10 000»
  for (let i = 0; i < 48; i++) {
    rows.push([
      'Иванов',
      pick(DEPARTMENTS),
      pick(AMOUNTS.filter((a) => a !== 10000)),
      dateOf(i + 132),
    ])
  }
  // остальные сотрудники, включая чужие 10 000 (фильтры должны объединяться по «И»)
  for (let i = 0; i < 320; i++) {
    rows.push([
      pick(SURNAMES),
      pick(DEPARTMENTS),
      i % 11 === 0 ? 10000 : pick(AMOUNTS),
      dateOf(i + 200),
    ])
  }
  // детерминированное перемешивание
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
  }
  return rows
}

async function makeDemoBook() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Сотрудники')
  ws.addRow(['Фамилия', 'Отдел', 'Сумма', 'Дата'])
  for (const row of buildDemoRows()) ws.addRow(row)
  // стили шапки: жирная, мятная заливка фирменной палитры — проверка
  // переноса стилей файл → модель → файл (Этап 2.3, «стили!»)
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FF2B2B2B' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F8EC' } }
  header.alignment = { horizontal: 'center' }
  ws.getColumn(1).width = 14
  ws.getColumn(2).width = 16
  ws.getColumn(3).width = 12
  ws.getColumn(4).width = 13

  const ref = wb.addWorksheet('Справочник')
  ref.addRow(['Отдел', 'Руководитель', 'Телефон'])
  const refHeader = ref.getRow(1)
  refHeader.font = { bold: true }
  refHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F8EC' } }
  ref.addRow(['Продажи', 'Алексеева М.', '101'])
  ref.addRow(['Логистика', 'Титов В.', '102'])
  ref.addRow(['Бухгалтерия', 'Гусева О.', '103'])
  ref.addRow(['Снабжение', 'Рябов К.', '104'])
  ref.getColumn(1).width = 16
  ref.getColumn(2).width = 18
  ref.getColumn(3).width = 12

  const path = join(outDir, 'demo-book.xlsx')
  await wb.xlsx.writeFile(path)
  return path
}

/* ── стресс 100k строк (CSV, разделитель «;» как в русском Excel) ────── */

const CATEGORIES = ['Электроника', 'Бытовая техника', 'Канцелярия', 'Инструменты', 'Освещение']
const STORES = ['Центральный', 'Северный', 'Восточный', 'Южный']

async function makeStressCsv() {
  const path = join(outDir, 'stress-100k.csv')
  const out = createWriteStream(path, { encoding: 'utf8' })
  out.write('\uFEFF№;Артикул;Наименование;Категория;Количество;Цена;Сумма;Склад\r\n')
  let buf = ''
  for (let i = 1; i <= 100_000; i++) {
    const qty = 1 + Math.floor(rnd() * 50)
    const price = 100 + Math.floor(rnd() * 9900)
    buf += `${i};A-${String(100000 + i)};Товар ${i};${pick(CATEGORIES)};${qty};${price};${qty * price};${pick(STORES)}\r\n`
    if (i % 5000 === 0) {
      out.write(buf)
      buf = ''
    }
  }
  out.write(buf)
  await new Promise((resolve, reject) => {
    out.end((err) => (err ? reject(err) : resolve()))
  })
  return path
}

/* ── старый .xls (SheetJS, BIFF8) — если сборка поддерживает запись ──── */

async function makeLegacyXls() {
  try {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const aoa = [
      ['Фамилия', 'Отдел', 'Сумма'],
      ['Иванов', 'Продажи', '10000'],
      ['Петров', 'Логистика', '12500'],
      ['Сидоров', 'Продажи', '8000'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1')
    const path = join(outDir, 'legacy-demo.xls')
    XLSX.writeFile(wb, path, { bookType: 'biff8' })
    return path
  } catch (err) {
    console.log(`.xls-фикстура пропущена (SheetJS не пишет BIFF8): ${err?.message ?? err}`)
    return null
  }
}

const demo = await makeDemoBook()
console.log(`OK: ${demo}`)
const stress = await makeStressCsv()
console.log(`OK: ${stress}`)
const legacy = await makeLegacyXls()
if (legacy) console.log(`OK: ${legacy}`)
