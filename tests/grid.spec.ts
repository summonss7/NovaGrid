import { expect, test, type Page } from '@playwright/test'
import type { NvTestApi } from '../src/grid/testHook'

/*
 * Этап 1 «Ядро таблицы» (КТ-2): e2e водит выделение и редактирование,
 * Alt-лассо живой суммы, undo/redo и прокрутку стресс-листа 100k×30.
 * Значения канваса недоступны DOM-локаторами, поэтому состояние читается
 * через тест-хук window.__nv (устанавливается только при ?test=1/?testui=1).
 * Объявление типа общее для всех спеков (NvTestApi из src/grid/testHook).
 */
declare global {
  interface Window {
    __nv?: NvTestApi
  }
}

/** Прокси к тест-хуку: функции не сериализуются через evaluate — каждый вызов уходит в страницу. */
function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    activeRef: () => page.evaluate(() => window.__nv!.activeRef()),
    metrics: () => page.evaluate(() => window.__nv!.metrics()),
    ranges: () => page.evaluate(() => window.__nv!.ranges()),
    visible: () => page.evaluate(() => window.__nv!.visible()),
    draw: () => page.evaluate(() => window.__nv!.draw()),
    resetDrawStats: () => page.evaluate(() => window.__nv!.resetDrawStats()),
    scrollTo: (x: number, y: number) =>
      page.evaluate(({ x, y }) => window.__nv!.scrollTo(x, y), { x, y }),
    editor: () => page.evaluate(() => window.__nv!.editor()),
  }
}

/** Клик мышью по центру ячейки (координаты берём у грида — метрики константны).
 *  Модификаторы эмулируются зажатием клавиш: у page.mouse нет параметра modifiers. */
async function clickCell(
  page: Page,
  row: number,
  col: number,
  opts?: { modifiers?: string[]; button?: 'left' | 'right' },
) {
  const center = await page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), {
    row,
    col,
  })
  const modifiers = opts?.modifiers ?? []
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.click(center.x, center.y, { button: opts?.button ?? 'left' })
  for (const m of modifiers) await page.keyboard.up(m)
}

test.describe('ядро таблицы — демо-лист', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  test('грид отрисовывает демо-данные; клик выбирает ячейку (строка формул живая)', async ({
    page,
  }) => {
    const api = nv(page)
    expect(await api.cell(1, 0)).toBe('Иванов')
    expect(await api.cell(1, 2)).toBe('10000')

    await clickCell(page, 1, 2)
    await expect(page.locator('.formula-ref')).toHaveText('C2')
    await expect(page.getByLabel('Строка формул')).toHaveValue('10000')
  })

  test('редактирование: ввод с заменой, Enter; F2 — правка значения, Escape — отмена', async ({
    page,
  }) => {
    const api = nv(page)
    const editor = page.getByLabel('Редактор ячейки')

    // ввод с клавиатуры сразу с символа: «X» открывает редактор с заменой
    await clickCell(page, 1, 1)
    await page.keyboard.press('X')
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue('X')
    await page.keyboard.type('-отдел')
    await page.keyboard.press('Enter')
    expect(await api.cell(1, 1)).toBe('X-отдел')
    // Enter фиксирует и сдвигает вниз
    await expect(page.locator('.formula-ref')).toHaveText('B3')

    // F2 открывает правку текущего значения, Escape отменяет
    await clickCell(page, 2, 2)
    await page.keyboard.press('F2')
    await expect(editor).toHaveValue('12500')
    await page.keyboard.type('0')
    await page.keyboard.press('Escape')
    expect(await api.cell(2, 2)).toBe('12500')
    expect(await api.editor()).toBeNull()
  })

  test('выделение Ф5: Shift-диапазон, Ctrl-несмежные, Ctrl+A, Esc — статус-бар живой', async ({
    page,
  }) => {
    const api = nv(page)
    const status = page.locator('.status-metrics')

    await clickCell(page, 1, 2) // Иванов 10000
    let m = await api.metrics()
    expect(m.count).toBe(1)
    expect(m.total).toBe(10000)

    // Shift+клик — диапазон C2:C4 (10000+12500+8000)
    await clickCell(page, 3, 2, { modifiers: ['Shift'] })
    m = await api.metrics()
    expect(m.count).toBe(3)
    expect(m.total).toBe(30500)
    expect(await api.ranges()).toEqual(['C2:C4'])
    await expect(status).toContainText('Σ')

    // Ctrl+клик — несмежная C7 (Волкова 9800): сумма как один массив
    await clickCell(page, 6, 2, { modifiers: ['Control'] })
    m = await api.metrics()
    expect(m.count).toBe(4)
    expect(m.total).toBe(40300)
    expect(await api.ranges()).toEqual(['C2:C4', 'C7:C7'])

    // Ctrl+A — весь контент: 6 чисел колонки C, 21 заполненная ячейка
    await page.keyboard.press('Control+a')
    m = await api.metrics()
    expect(m.count).toBe(6)
    expect(m.filled).toBe(21)
    expect(m.total).toBe(59800)

    // Esc — снять выделение до активной ячейки
    await page.keyboard.press('Escape')
    m = await api.metrics()
    expect(m.count).toBe(1)
  })

  test('undo/redo: правка, очистка Delete — откат и возврат', async ({ page }) => {
    const api = nv(page)

    await clickCell(page, 1, 2)
    await page.keyboard.press('5')
    await page.keyboard.type('55')
    await page.keyboard.press('Enter')
    expect(await api.cell(1, 2)).toBe('555')

    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 2)).toBe('10000')
    await page.keyboard.press('Control+y')
    expect(await api.cell(1, 2)).toBe('555')

    // Delete очищает, Ctrl+Z возвращает
    await clickCell(page, 1, 2)
    await page.keyboard.press('Delete')
    expect(await api.cell(1, 2)).toBe('')
    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 2)).toBe('555')
  })

  test('клавиатурная навигация: стрелки двигают активную ячейку, Shift растягивает', async ({
    page,
  }) => {
    const api = nv(page)

    await clickCell(page, 0, 0)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    expect(await api.activeRef()).toBe('B3')
    await expect(page.locator('.formula-ref')).toHaveText('B3')

    await page.keyboard.press('Shift+ArrowDown')
    expect(await api.ranges()).toEqual(['B3:B4'])

    // Ctrl+стрелка прыгает к краю серии данных
    await page.keyboard.press('Control+ArrowDown')
    expect(await api.activeRef()).toBe('B7')
  })

  test('Alt+перетаскивание: живая сумма у курсора оранжевым лассо (Ф4, механика КТ-2)', async ({
    page,
  }) => {
    await nv(page).ready()
    const label = page.locator('.alt-sum-label')

    // до лассо выделена одна ячейка C2 — лассо не должно её затереть
    await clickCell(page, 1, 2)
    const from = await page.evaluate(() => window.__nv!.cellCenter(1, 2))
    const to = await page.evaluate(() => window.__nv!.cellCenter(3, 2))

    await page.mouse.move(from.x, from.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 5 })
    // лассо C2:C4 → 10000+12500+8000 = 30 500 — показывается без единого клика
    await expect(label).toBeVisible()
    await expect(label).toHaveText(/30[\s\u00a0]500/)

    // отпустили — лассо ушло, прежнее выделение не тронуто
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect(label).toBeHidden()
    const m = await page.evaluate(() => window.__nv!.metrics())
    expect(m.total).toBe(10000)
  })

  test('ПКМ вне выделения выбирает ячейку; Shift+клик по шапке колонки — целиком', async ({
    page,
  }) => {
    const api = nv(page)
    await clickCell(page, 1, 2)
    await clickCell(page, 5, 1, { modifiers: ['Control'] }) // выделение из двух областей

    // ПКМ по ячейке вне выделения — она становится активной, области не сломаны
    await clickCell(page, 6, 0, { button: 'right' })
    expect(await api.activeRef()).toBe('A7')

    // клик по шапке колонки B — выделение всей колонки
    await clickCell(page, -1, 1)
    const m = await api.metrics()
    expect(m.filled).toBe(7) // B1 «Отдел» + 6 отделов
  })
})

test.describe('стресс 100k×30 — виртуализация (1.2)', () => {
  test('прокрутка в глубину рисует правильное окно, кадр укладывается в бюджет 60 fps', async ({
    page,
  }) => {
    await page.goto('/?test=1&stress=100000')
    const api = nv(page)
    await api.ready()

    // вглубь: последняя сотня строк листа
    await api.scrollTo(0, 30 * 100000 - 600)
    await page.waitForTimeout(100) // кадр по rAF
    const region = await api.visible()
    expect(region).not.toBeNull()
    expect(region!.firstRow).toBeGreaterThan(99950)
    expect(region!.lastRow).toBeLessThanOrEqual(99999)

    // стоимость кадра: только видимое окно ~20×12 ячеек, не 100k×30
    await api.resetDrawStats()
    for (let i = 0; i < 10; i++) {
      await api.scrollTo(0, 30 * 100000 - 600 - i * 137)
      await page.waitForTimeout(20)
    }
    const d = await api.draw()
    // rAF может склеить соседние скроллы в один кадр — допускаем слипание
    expect(d.frames).toBeGreaterThanOrEqual(8)
    expect(d.avgMs).toBeLessThan(16) // бюджет кадра 60 fps

    // значения читаются из модели на любой глубине
    expect(await api.cell(99999, 0)).toBe('100000')
  })
})
