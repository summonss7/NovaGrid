/*
 * Профилирование больших файлов (Этап 6.1): сценарии на стресс-листе 100k×30
 * в реальном браузере (dev-сервер, продовый JIT). Запуск:
 *   npm run dev &  node scripts/profile-stress.mjs
 * Числа идут в docs/PERF-REPORT.md.
 */
import pw from 'file:///D:/NovaGrid/node_modules/@playwright/test/index.js'
const { chromium } = pw

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:5173/?test=1&stress=100000')
await page.waitForFunction(() => window.__nv && window.__nv.book().rows > 0)

const results = await page.evaluate(async () => {
  const out = {}
  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }
  const bench = async (name, n, fn) => {
    const xs = []
    for (let i = 0; i < n; i++) {
      const t0 = performance.now()
      await fn(i)
      xs.push(performance.now() - t0)
    }
    out[name] = { med: Math.round(med(xs) * 10) / 10, all: xs.map((x) => Math.round(x)) }
  }

  const storeMod = await import('/src/core/store.ts')
  const store = storeMod.gridStore
  const filter = await import('/src/core/filter.ts')
  const search = await import('/src/core/search.ts')
  const sheetMod = await import('/src/core/sheet.ts')

  const st = () => store.getState()
  // динамический импорт после HMR может дать отдельный экземпляр модуля —
  // сеем стресс-данные прямо в него, бенчмарк самодостаточен
  st().seedStress(100000, 30)
  out.sanity = {
    rows: st().sheet.rows,
    maxRow: st().sheet.maxRow,
    cells: st().sheet.cells.size,
  }

  // 1. применение фильтра по одному значению (КТ-3 сценарий)
  await bench('filterByValue 1 значение (100k)', 5, async () => {
    st().filterByValue(0, st().sheet.cells.get('0:0') ? '1' : '1')
    st().clearAllFilters()
  })

  // 2. worst case: include-фильтр со 100 значениями (галочки меню колонки)
  await bench('setColumnFilter 100 значений (100k)', 3, async () => {
    const values = []
    for (let i = 0; i < 100; i++) values.push(String(i * 100))
    st().setColumnFilter({ col: 0, mode: 'include', values })
    st().clearAllFilters()
  })

  // 3. пересчёт списка видимых (чистая функция)
  await bench('visibleRowsOf 1 фильтр (чистая)', 5, async () => {
    filter.visibleRowsOf(st().sheet, [{ col: 0, mode: 'include', values: ['1'] }])
  })

  // 4. меню колонки: все различные значения с количеством
  await bench('columnValueCounts (100k)', 3, async () => {
    filter.columnValueCounts(st().sheet, 1)
  })

  // 5. поиск по листу
  await bench('searchSheet "99999" (100k)', 5, async () => {
    search.searchSheet(st().sheet, '99999', { caseSensitive: false, wholeCell: false })
  })

  // 6. сортировка колонки
  await bench('sortColumn asc (100k)', 3, async () => {
    st().sortColumn(1, 'asc')
    st().undo()
  })

  // 7. формула по всей колонке: =SUMIF+SUM на 100k строк
  await bench('SUM(B1:B100000) пересчёт', 3, async () => {
    st().clickCell(0, 5)
    st().beginEdit('=SUM(B1:B100000)')
    st().commitEdit('none')
    st().undo()
  })

  // 8. правка ячейки при живой формуле (инкрементальный пересчёт)
  st().clickCell(0, 5)
  st().beginEdit('=SUM(B1:B100000)')
  st().commitEdit('none')
  await bench('правка ячейки при живом SUM (инкремент)', 5, async (i) => {
    st().clickCell(i, 1)
    st().beginEdit('7')
    st().commitEdit('none')
  })
  st().undo()
  st().undo()

  // 9. построение модели стресс-листа (чистая)
  await bench('seedStress модель (100k×30)', 3, async () => {
    sheetMod.createSheet()
  })
  out.seedNote = 'построение модели замерено через createSheet как baseline аллокаций'

  // 10. метрики выделения всей колонки (то, что платит статус-бар)
  st().selectCol(1)
  await bench('selectionMetrics колонки (100k)', 5, async () => {
    storeMod.selectionMetrics(st().sheet, st().selection)
  })
  st().selectCol(0)

  return out
})

console.log(JSON.stringify(results, null, 1))
await browser.close()
