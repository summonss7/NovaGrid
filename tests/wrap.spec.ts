import { expect, test, type Page } from '@playwright/test'

/*
 * Перенос текста в ячейке (novagrid-048): кнопка панели форматирования,
 * автовысота строки под число строк, пересчёт от ширины колонки и зума,
 * сочетание с форматом числа и выравниванием, Ctrl+Z одной транзакцией.
 */

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    style: (row: number, col: number) =>
      page.evaluate(
        ({ row, col }) => JSON.stringify(window.__nv!.style(row, col) ?? null),
        { row, col },
      ),
    rowHeight: (row: number) =>
      page.evaluate(({ row }) => window.__nv!.rowHeight(row), { row }),
    metrics: () => page.evaluate(() => window.__nv!.cellMetrics()),
    setColWidth: (col: number, width: number) =>
      page.evaluate(
        ({ col, width }) => window.__nv!.setColWidth(col, width),
        { col, width },
      ),
    scrollTo: (x: number, y: number) =>
      page.evaluate(({ x, y }) => window.__nv!.scrollTo(x, y), { x, y }),
    colWidth: (col: number) =>
      page.evaluate(({ col }) => window.__nv!.colWidth(col), { col }),
  }
}

/** Сумма RGB пикселя канваса; x/y — координаты ВЬЮПОРТА (перевод внутри). */
function canvasPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const d = ctx.getImageData(
        Math.round((x - rect.left) * dpr),
        Math.round((y - rect.top) * dpr),
        1,
        1,
      ).data
      return d[0] + d[1] + d[2]
    },
    { x, y },
  )
}

/** Есть ли «чернила» текста в горизонтальной полосе ячейки (шаг 3px). */
async function stripHasInk(page: Page, x0: number, x1: number, y: number) {
  for (let x = x0; x <= x1; x += 3) {
    if ((await canvasPixel(page, x, y)) < 500) return true
  }
  return false
}

/** Длинный текст: при стандартной колонке ~96px — заведомо несколько строк. */
const LONG_TEXT =
  'Очень длинный текст, который точно не помещается в стандартную колонку таблицы одной строкой'

async function typeIntoCell(page: Page, row: number, col: number, text: string) {
  const api = nv(page)
  // далёкая строка — сначала прокрутка, cellCenter даёт координаты вьюпорта
  await api.scrollTo(0, row * 30)
  const c = await api.cellCenter(row, col)
  await page.mouse.click(c.x, c.y)
  await page.keyboard.type(text)
  await page.keyboard.press('Enter') // фиксация переводит курсор вниз
  // возвращаем выделение на введённую ячейку — кнопки панели бьют по нему
  const back = await api.cellCenter(row, col)
  await page.mouse.click(back.x, back.y)
}

test.describe('novagrid-048: перенос текста в ячейке', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  test('кнопка «Перенос текста»: высота строки растёт, Ctrl+Z откатывает одной транзакцией', async ({
    page,
  }) => {
    const api = nv(page)
    const m = await api.metrics()
    await typeIntoCell(page, 30, 5, LONG_TEXT)
    // без переноса строка стандартная, текст обрезается многоточием
    expect(await api.rowHeight(30)).toBe(m.rowH)
    // стиля нет
    expect(await api.style(30, 5)).toBe('null')

    await page.locator('.fmt-btn[aria-label="Перенос текста"]').click()
    expect(await api.style(30, 5)).toBe(JSON.stringify({ wrap: true }))
    const grown = await api.rowHeight(30)
    expect(grown).toBeGreaterThan(m.rowH)

    // Ctrl+Z — снимает перенос и возвращает высоту
    await page.locator('.grid-area').focus()
    await page.keyboard.press('Control+z')
    expect(await api.style(30, 5)).toBe('null')
    expect(await api.rowHeight(30)).toBe(m.rowH)

    // повторное включение и повторный клик по кнопке — снять (как Ж в Excel)
    await page.locator('.fmt-btn[aria-label="Перенос текста"]').click()
    expect(JSON.parse(await api.style(30, 5)).wrap).toBe(true)
    await page.locator('.fmt-btn[aria-label="Перенос текста"]').click()
    expect(await api.style(30, 5)).toBe('null')
  })

  test('смена ширины колонки пересчитывает перенос и высоту', async ({ page }) => {
    const api = nv(page)
    const m = await api.metrics()
    await typeIntoCell(page, 30, 5, LONG_TEXT)
    await page.locator('.fmt-btn[aria-label="Перенос текста"]').click()
    const normal = await api.rowHeight(30)
    expect(normal).toBeGreaterThan(m.rowH)

    // узкая колонка — больше строк, выше строка
    await api.setColWidth(5, 40)
    const narrow = await api.rowHeight(30)
    expect(narrow).toBeGreaterThan(normal)

    // широкая колонка — меньше строк
    await api.setColWidth(5, 400)
    const wide = await api.rowHeight(30)
    expect(wide).toBeLessThan(narrow)
    // и ширина колонки реально применилась
    expect(await api.colWidth(5)).toBeGreaterThan(m.colW)

    await api.setColWidth(5, 96) // вернуть стандартную
    expect(await api.rowHeight(30)).toBe(normal)
  })

  test('смена масштаба пересчитывает перенос и высоту', async ({ page }) => {
    const api = nv(page)
    await typeIntoCell(page, 30, 5, LONG_TEXT)
    await page.locator('.fmt-btn[aria-label="Перенос текста"]').click()
    const at100 = await api.rowHeight(30)

    // Ctrl + = (зум 110%): шрифт и метрики крупнее — высота другая
    await page.locator('.grid-area').focus()
    await page.keyboard.press('Control+=')
    const at110 = await api.rowHeight(30)
    const m110 = await api.metrics()
    expect(m110.rowH).toBeGreaterThan(30)
    expect(at110).toBeGreaterThan(at100)

    // Ctrl+0 — назад к 100%
    await page.keyboard.press('Control+0')
    expect(await api.rowHeight(30)).toBe(at100)
  })

  test('перенос сочетается с форматом числа и выравниванием; текст рисуется строками сверху', async ({
    page,
  }) => {
    const api = nv(page)
    const m = await api.metrics()
    await typeIntoCell(page, 30, 5, '1234567890.5')
    // формат «Процентный» удлиняет отображение: 123456789050,00 %
    await page.locator('.fmt-select[aria-label="Формат числа"]').selectOption('percent')
    await page.locator('.fmt-btn[aria-label="Выравнивание по центру"]').click()
    await page.locator('.fmt-btn[aria-label="Перенос текста"]').click()

    expect(JSON.parse(await api.style(30, 5))).toEqual({
      wrap: true,
      fmt: 'percent',
      align: 'center',
    })
    const h = await api.rowHeight(30)
    expect(h).toBeGreaterThan(m.rowH)

    // пиксельная проверка: чернила в первой и во второй строке текста
    // (перенос по словам при колонке 96px: «123 456 789 050,00 %» не влезает)
    const center = await api.cellCenter(30, 5)
    const top = center.y - h / 2
    const left = center.x - m.colW / 2
    const lineH = Math.ceil(13.5 * 1.32) // px шрифта грида 13.5, K = 1.32
    const padY = Math.floor((m.rowH - lineH) / 2)
    expect(await stripHasInk(page, left + 8, left + m.colW - 8, top + padY + lineH / 2)).toBe(true)
    expect(await stripHasInk(page, left + 8, left + m.colW - 8, top + padY + lineH * 1.5)).toBe(
      true,
    )
    // под текстом (у нижней границы ячейки) чисто — строки не расползлись
    expect(await stripHasInk(page, left + 8, left + m.colW - 8, top + h - 3)).toBe(false)
  })
})
