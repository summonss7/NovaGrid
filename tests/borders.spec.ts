import { expect, test, type Page } from '@playwright/test'

/*
 * Границы ячеек (novagrid-049): выпадающий список «Границы» FormatBar
 * (все / внешние / убрать), применение к выделению, Ctrl+Z одной
 * транзакцией, пиксели канваса (линии не двоятся), вставка строки и
 * объединение сохраняют границы. Демо-книга: данные в A1:C8, правее чисто.
 */

type Nv = ReturnType<typeof nv>

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    activeRef: () => page.evaluate(() => window.__nv!.activeRef()),
    style: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.style(row, col), { row, col }),
    metrics: () => page.evaluate(() => window.__nv!.cellMetrics()),
  }
}

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Иванов')
}

/** RGB-пиксель канваса (координаты канваса, dpr учтён). */
function canvasPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data
      return [d[0], d[1], d[2]] as const
    },
    { x, y },
  )
}

/** Пиксель на вертикальной границе колонок col|col+1 (dy от верха строки). */
async function colLinePixel(page: Page, api: Nv, row: number, col: number, dy = 5) {
  const m = await api.metrics()
  // правый край колонки — по фактическим ширинам (фикстуры везут свои,
  // novagrid-050), а не «метрика × номер»
  const edge = await page.evaluate(
    (c) => {
      let x = 0
      for (let i = 0; i <= c; i++) x += window.__nv!.colWidth(i)
      return x
    },
    col,
  )
  return canvasPixel(page, m.rowHeaderW + edge, m.headerH + row * m.rowH + dy)
}

/** Пиксель на горизонтальной границе строк row|row+1 (dx от левого края колонки). */
async function rowLinePixel(page: Page, api: Nv, row: number, col: number, dx = 5) {
  const m = await api.metrics()
  const left = await page.evaluate(
    (c) => {
      let x = 0
      for (let i = 0; i < c; i++) x += window.__nv!.colWidth(i)
      return x
    },
    col,
  )
  return canvasPixel(page, m.rowHeaderW + left + dx, m.headerH + (row + 1) * m.rowH)
}

/** Выделить B2:C3 кликом + Shift-кликом. */
async function selectB2C3(page: Page, api: Nv) {
  const b2 = await api.cellCenter(1, 1)
  const c3 = await api.cellCenter(2, 2)
  await page.mouse.click(b2.x, b2.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(c3.x, c3.y)
  await page.keyboard.up('Shift')
}

/** Открыть меню «Границы» и выбрать вид. */
async function pickBorders(page: Page, item: string) {
  await page.locator('.fmt-btn[aria-label="Границы"]').click()
  await page.getByRole('menuitem', { name: item }).click()
}

test.describe('novagrid-049: границы из выпадающего списка FormatBar', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('«Все границы»: внутренние и внешние линии видны, Ctrl+Z снимает одним шагом', async ({
    page,
  }) => {
    const api = nv(page)
    await selectB2C3(page, api)
    await pickBorders(page, 'Все границы')
    // модель: у ячеек выделения четыре стороны
    expect((await api.style(1, 1))?.borders).toEqual({
      top: true,
      right: true,
      bottom: true,
      left: true,
    })
    // выделение уводим — заливка подсветки мешает пикселям
    const d6 = await api.cellCenter(5, 3)
    await page.mouse.click(d6.x, d6.y)
    await expect.poll(() => api.activeRef()).toBe('D6')
    // внутренняя линия B|C на строке 2 — тёмная граница, не сетка
    expect((await colLinePixel(page, api, 1, 1))[0]).toBeLessThan(100)
    // внешние края: A|B слева, C|D справа, границы строк 1|2 и 3|4
    expect((await colLinePixel(page, api, 1, 0))[0]).toBeLessThan(100)
    expect((await colLinePixel(page, api, 1, 2))[0]).toBeLessThan(100)
    expect((await rowLinePixel(page, api, 0, 1))[0]).toBeLessThan(100)
    expect((await rowLinePixel(page, api, 2, 1))[0]).toBeLessThan(100)
    // вне диапазона границ нет: линия C|D на строке 5 — обычная сетка
    expect((await colLinePixel(page, api, 4, 2))[0]).toBeGreaterThan(200)

    // один Ctrl+Z — границ нет, стиль ячейки пуст
    await page.keyboard.press('Control+z')
    expect(await api.style(1, 1)).toBeNull()
    expect((await colLinePixel(page, api, 1, 1))[0]).toBeGreaterThan(200)
  })

  test('«Внешние границы»: периметр тёмный, внутренняя линия не рисуется', async ({ page }) => {
    const api = nv(page)
    await selectB2C3(page, api)
    await pickBorders(page, 'Внешние границы')
    expect((await api.style(1, 1))?.borders).toEqual({ top: true, left: true })
    expect((await api.style(1, 2))?.borders).toEqual({ top: true, right: true })
    const d6 = await api.cellCenter(5, 3)
    await page.mouse.click(d6.x, d6.y)
    await expect.poll(() => api.activeRef()).toBe('D6')
    // периметр
    expect((await colLinePixel(page, api, 1, 0))[0]).toBeLessThan(100)
    expect((await colLinePixel(page, api, 1, 2))[0]).toBeLessThan(100)
    expect((await rowLinePixel(page, api, 0, 1))[0]).toBeLessThan(100)
    expect((await rowLinePixel(page, api, 2, 1))[0]).toBeLessThan(100)
    // внутренняя граница B|C — осталась светлой сеткой
    expect((await colLinePixel(page, api, 1, 1))[0]).toBeGreaterThan(200)
    expect((await colLinePixel(page, api, 2, 1))[0]).toBeGreaterThan(200)
  })

  test('«Убрать границы» снимает; Ctrl+Z возвращает', async ({ page }) => {
    const api = nv(page)
    await selectB2C3(page, api)
    await pickBorders(page, 'Все границы')
    await pickBorders(page, 'Убрать границы')
    expect(await api.style(1, 1)).toBeNull()
    const d6 = await api.cellCenter(5, 3)
    await page.mouse.click(d6.x, d6.y)
    await expect.poll(() => api.activeRef()).toBe('D6')
    expect((await colLinePixel(page, api, 1, 1))[0]).toBeGreaterThan(200)
    // откат «убрать» возвращает «все» (одна транзакция)
    await page.keyboard.press('Control+z')
    expect((await api.style(1, 1))?.borders?.top).toBe(true)
    expect((await colLinePixel(page, api, 1, 1))[0]).toBeLessThan(100)
  })

  test('стороны дописываются: верхняя не стирает нижнюю', async ({ page }) => {
    const api = nv(page)
    const b2 = await api.cellCenter(1, 1)
    await page.mouse.click(b2.x, b2.y)
    await pickBorders(page, 'Верхняя граница')
    await pickBorders(page, 'Нижняя граница')
    expect((await api.style(1, 1))?.borders).toEqual({ top: true, bottom: true })
  })
})

test.describe('novagrid-049: границы при правках структуры', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('вставка строки сдвигает границы вместе с контентом', async ({ page }) => {
    const api = nv(page)
    await selectB2C3(page, api)
    await pickBorders(page, 'Все границы')
    // ПКМ по номеру строки 2 → «Вставить строку выше»
    const rowHead = await page.evaluate(() => {
      const main = document.querySelector('.grid-area')!.getBoundingClientRect()
      const m = window.__nv!.cellMetrics()
      return { x: main.left + m.rowHeaderW / 2, y: main.top + m.headerH + m.rowH * 1.5 }
    })
    await page.mouse.click(rowHead.x, rowHead.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Вставить строку выше' }).click()
    await expect.poll(() => api.activeRef()).toBe('B3')
    // границы уехали на строку вниз, вставленная строка чиста
    expect((await api.style(1, 1))?.borders).toBeUndefined()
    expect((await api.style(2, 1))?.borders).toEqual({
      top: true,
      right: true,
      bottom: true,
      left: true,
    })
    // откат возвращает границы на место
    await page.keyboard.press('Control+z')
    expect((await api.style(1, 1))?.borders?.top).toBe(true)
  })

  test('объединение ячеек сохраняет периметр границ', async ({ page }) => {
    const api = nv(page)
    // пустой блок E2:F3 правее данных: границы → объединение без потери данных
    for (const [r, c] of [
      [1, 4],
      [1, 5],
      [2, 4],
      [2, 5],
    ])
      expect(await api.cell(r, c)).toBe('')
    const e2 = await api.cellCenter(1, 4)
    const f3 = await api.cellCenter(2, 5)
    await page.mouse.click(e2.x, e2.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(f3.x, f3.y)
    await page.keyboard.up('Shift')
    await pickBorders(page, 'Все границы')
    let dialogSeen = false
    page.on('dialog', (d) => {
      dialogSeen = true
      void d.accept()
    })
    await page.locator('.fmt-btn[aria-label="Объединить ячейки"]').click()
    expect(dialogSeen).toBe(false)
    const b6 = await api.cellCenter(5, 1)
    await page.mouse.click(b6.x, b6.y)
    await expect.poll(() => api.activeRef()).toBe('B6')
    const m = await api.metrics()
    // периметр объединения E2:F3: верх, низ, лево, право — тёмные
    expect(
      (await canvasPixel(page, m.rowHeaderW + 4.5 * m.colW, m.headerH + 1 * m.rowH))[0],
    ).toBeLessThan(100)
    expect(
      (await canvasPixel(page, m.rowHeaderW + 4.5 * m.colW, m.headerH + 3 * m.rowH))[0],
    ).toBeLessThan(100)
    expect((await colLinePixel(page, api, 1, 3))[0]).toBeLessThan(100) // D|E
    expect((await colLinePixel(page, api, 1, 5))[0]).toBeLessThan(100) // F|G
    // внутри объединения линий нет: E|F — белый фон (как у merge-тестов 047)
    expect(await colLinePixel(page, api, 1, 4)).toEqual([255, 255, 255])
    expect(await colLinePixel(page, api, 2, 4)).toEqual([255, 255, 255])
    // Ctrl+Z: снимается объединение, границы возвращаются на ячейки
    await page.keyboard.press('Control+z')
    expect((await api.style(1, 4))?.borders?.top).toBe(true)
    expect((await colLinePixel(page, api, 1, 4))[0]).toBeLessThan(100)
  })
})
