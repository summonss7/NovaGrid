import { expect, test, type Page } from '@playwright/test'

/*
 * Объединение ячеек как в Excel (novagrid-047): импорт mergeCells из .xlsx,
 * кнопки панели форматирования и ПКМ-меню, предупреждение о потере данных,
 * Ctrl+Z одной транзакцией, клавиатура не заходит в скрытые ячейки.
 * Фикстура merged-book.xlsx: A1:C1 «Продажи за год» (шапка) и A4:A5.
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
    ranges: () => page.evaluate(() => window.__nv!.ranges()),
    merges: () => page.evaluate(() => JSON.stringify(window.__nv!.merges())),
    metrics: () => page.evaluate(() => window.__nv!.cellMetrics()),
  }
}

async function openMergedBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/merged-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(0, 0) ?? ''), { timeout: 5000 })
    .toBe('Продажи за год')
}

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Иванов')
}

/** RGB-пиксель канваса (CSS-координаты канваса, dpr учтён). */
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

/**
 * Пиксель на вертикальной границе колонок col|col+1; dy — отступ от верха
 * строки (5 — над текстом: заголовки демо-книги отцентрированы, середина
 * строки занята буквами).
 */
async function colBorderPixel(page: Page, api: Nv, row: number, col: number, dy = 5) {
  const m = await api.metrics()
  const x = m.rowHeaderW + (col + 1) * m.colW
  const y = m.headerH + row * m.rowH + dy
  return canvasPixel(page, x, y)
}

test.describe('novagrid-047: импорт объединённых ячеек из .xlsx', () => {
  test.beforeEach(async ({ page }) => {
    await openMergedBook(page)
  })

  test('объединения читаются: грид без внутренней линии, клик по скрытой ячейке — на угол', async ({
    page,
  }) => {
    const api = nv(page)
    // обе области объединения из файла
    await expect
      .poll(() => api.merges())
      .toBe(JSON.stringify([{ r1: 0, c1: 0, r2: 0, c2: 2 }, { r1: 3, c1: 0, r2: 4, c2: 0 }]))
    // внутри объединения A1:C1 нет линий сетки: граница A|B и B|C — фон, не линия
    expect(await colBorderPixel(page, api, 0, 0)).toEqual([255, 255, 255])
    expect(await colBorderPixel(page, api, 0, 1)).toEqual([255, 255, 255])
    // у обычной пары B2|C2 линия на месте
    expect((await colBorderPixel(page, api, 1, 1))[0]).toBeLessThan(250)

    // скрытые ячейки пусты; клик по C1 выбирает угол A1
    expect(await api.cell(0, 2)).toBe('')
    const c1 = await api.cellCenter(0, 2)
    await page.mouse.click(c1.x, c1.y)
    await expect.poll(() => api.activeRef()).toBe('A1')
  })

  test('Tab/Enter перепрыгивают объединение, ПКМ «Отменить объединение» снимает', async ({
    page,
  }) => {
    const api = nv(page)
    // клик по объединённой шапке фокусирует грид (клавиатура без клика идёт в body)
    const head = await api.cellCenter(0, 0)
    await page.mouse.click(head.x, head.y)
    await expect.poll(() => api.activeRef()).toBe('A1')
    // Tab из A1 (A1:C1) → D1, обратно Shift+Tab → A1
    await page.keyboard.press('Tab')
    await expect.poll(() => api.activeRef()).toBe('D1')
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => api.activeRef()).toBe('A1')
    // Enter из объединённой шапки — под объединение (строка 2)
    await page.keyboard.press('Enter')
    await expect.poll(() => api.activeRef()).toBe('A2')

    // ПКМ по объединённой шапке → «Отменить объединение»
    const a1 = await api.cellCenter(0, 0)
    await page.mouse.click(a1.x, a1.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Отменить объединение' }).click()
    await expect
      .poll(() => api.merges())
      .toBe(JSON.stringify([{ r1: 3, c1: 0, r2: 4, c2: 0 }]))
    // линии сетки вернулись
    expect((await colBorderPixel(page, api, 0, 1))[0]).toBeLessThan(250)
    // Ctrl+Z возвращает объединение
    await page.keyboard.press('Control+z')
    await expect.poll(() => api.merges()).toBe(
      JSON.stringify([{ r1: 0, c1: 0, r2: 0, c2: 2 }, { r1: 3, c1: 0, r2: 4, c2: 0 }]),
    )
  })
})

test.describe('novagrid-047: объединение из UI с предупреждением и откатом', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('кнопка «Объединить»: потеря данных спрашивает подтверждение, Ctrl+Z возвращает всё', async ({
    page,
  }) => {
    const api = nv(page)
    // выделяем шапку B1:C1 (обе ячейки непусты — будет предупреждение)
    const b1 = await api.cellCenter(0, 1)
    const c1 = await api.cellCenter(0, 2)
    await page.mouse.click(b1.x, b1.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(c1.x, c1.y)
    await page.keyboard.up('Shift')

    let dialogText = ''
    page.on('dialog', (d) => {
      dialogText = d.message()
      void d.accept()
    })
    await page.locator('.fmt-btn[aria-label="Объединить ячейки"]').click()
    await expect
      .poll(() => api.merges())
      .toBe(JSON.stringify([{ r1: 0, c1: 1, r2: 0, c2: 2 }]))
    expect(dialogText).toContain('левой верхней')
    // значение осталось только в B1; выделение — область объединения
    expect(await api.cell(0, 1)).toBe('Отдел')
    expect(await api.cell(0, 2)).toBe('')
    await expect.poll(() => api.ranges()).toEqual(['B1:C1'])
    // внутренняя линия между B1|C1 исчезла: уводим выделение (подсветка мешает
    // пикселям) — граница красится заливкой шапки демо-книги #E8F8EC, без линии
    const d4 = await api.cellCenter(3, 3)
    await page.mouse.click(d4.x, d4.y)
    await expect.poll(() => api.activeRef()).toBe('D4')
    expect(await colBorderPixel(page, api, 0, 1)).toEqual([232, 248, 236])
    // у невыделенной пары B2|C2 линия на месте (тот же отступ от верха)
    expect((await colBorderPixel(page, api, 1, 1))[0]).toBeLessThan(250)

    // один Ctrl+Z: объединение снято, оба значения вернулись
    await page.keyboard.press('Control+z')
    await expect.poll(() => api.merges()).toBe('[]')
    expect(await api.cell(0, 1)).toBe('Отдел')
    expect(await api.cell(0, 2)).toBe('Сумма')
  })

  test('отказ от объединения с потерей данных ничего не меняет; пустой блок объединяется без вопроса', async ({
    page,
  }) => {
    const api = nv(page)
    const b1 = await api.cellCenter(0, 1)
    const c1 = await api.cellCenter(0, 2)
    await page.mouse.click(b1.x, b1.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(c1.x, c1.y)
    await page.keyboard.up('Shift')

    page.on('dialog', (d) => void d.dismiss())
    await page.locator('.fmt-btn[aria-label="Объединить ячейки"]').click()
    await page.waitForTimeout(150)
    expect(await api.merges()).toBe('[]')
    expect(await api.cell(0, 2)).toBe('Сумма')

    // пустые ячейки объединяются без предупреждения (диалог не должен всплыть)
    let dialogSeen = false
    page.on('dialog', (d) => {
      dialogSeen = true
      void d.accept()
    })
    const e1 = await api.cellCenter(0, 4)
    const f1 = await api.cellCenter(0, 5)
    await page.mouse.click(e1.x, e1.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(f1.x, f1.y)
    await page.keyboard.up('Shift')
    await page.locator('.fmt-btn[aria-label="Объединить ячейки"]').click()
    await expect
      .poll(() => api.merges())
      .toBe(JSON.stringify([{ r1: 0, c1: 4, r2: 0, c2: 5 }]))
    expect(dialogSeen).toBe(false)

    // кнопка «Разъединить» панели снимает объединение
    await page.locator('.fmt-btn[aria-label="Отменить объединение ячеек"]').click()
    await expect.poll(() => api.merges()).toBe('[]')
  })

  test('ПКМ «Объединить ячейки» на выделении; вставка строки сдвигает объединение', async ({
    page,
  }) => {
    const api = nv(page)
    const b1 = await api.cellCenter(0, 1)
    const c1 = await api.cellCenter(0, 2)
    await page.mouse.click(b1.x, b1.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(c1.x, c1.y)
    await page.keyboard.up('Shift')
    await page.mouse.click(c1.x, c1.y, { button: 'right' })
    page.on('dialog', (d) => void d.accept())
    await page.getByRole('menuitem', { name: 'Объединить ячейки' }).click()
    await expect
      .poll(() => api.merges())
      .toBe(JSON.stringify([{ r1: 0, c1: 1, r2: 0, c2: 2 }]))

    // вставка строки над шапкой уводит объединение вниз (ПКМ по номеру строки)
    const rowHead = await page.evaluate(() => {
      const main = document.querySelector('.grid-area')!.getBoundingClientRect()
      const m = window.__nv!.cellMetrics()
      return { x: main.left + m.rowHeaderW / 2, y: main.top + m.headerH + m.rowH / 2 }
    })
    await page.mouse.click(rowHead.x, rowHead.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Вставить строку выше' }).click()
    await expect
      .poll(() => api.merges())
      .toBe(JSON.stringify([{ r1: 1, c1: 1, r2: 1, c2: 2 }]))
    expect(await api.cell(1, 1)).toBe('Отдел')
  })
})
