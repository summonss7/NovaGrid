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

  test('Shift+стрелки растягивают выделение дальше двух ячеек (novagrid-024)', async ({
    page,
  }) => {
    const api = nv(page)

    await clickCell(page, 0, 0)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    expect(await api.ranges()).toEqual(['A1:A4'])
    // якорь-активная ячейка на месте, как в Excel
    expect(await api.activeRef()).toBe('A1')

    // «туда-сюда»: противоход сжимает диапазон, затем растёт в сторону
    await page.keyboard.press('Shift+ArrowUp')
    expect(await api.ranges()).toEqual(['A1:A3'])
    await page.keyboard.press('Shift+ArrowRight')
    expect(await api.ranges()).toEqual(['A1:B3'])

    // протяжка мышью + Shift-стрелка продолжают от конца диапазона
    await clickCell(page, 1, 2)
    await clickCell(page, 2, 2, { modifiers: ['Shift'] })
    await page.keyboard.press('Shift+ArrowDown')
    expect(await api.ranges()).toEqual(['C2:C4'])
    const m = await api.metrics()
    expect(m.total).toBe(30500)
  })

  test('Ctrl+C копирует выделенный диапазон в буфер (novagrid-024)', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    // прямоугольник A1:B2 — таб между колонками, перевод строки между строками
    // (буфер Windows нормализует \n в \r\n — сравниваем без учёта этого)
    await clickCell(page, 0, 0)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() =>
        page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'))),
      )
      .toBe('Фамилия\tОтдел\nИванов\tПродажи')

    // несмежные области — общий прямоугольник охвата
    await clickCell(page, 0, 0)
    await clickCell(page, 1, 2, { modifiers: ['Control'] })
    await page.keyboard.press('Control+c')
    await expect
      .poll(() =>
        page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'))),
      )
      .toBe('Фамилия\tОтдел\tСумма\nИванов\tПродажи\t10000')
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

test.describe('вставка Ctrl+V (novagrid-025)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  test('Ctrl+C → Ctrl+V: блок ложится от активной ячейки, Ctrl+Z откатывает целиком', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const api = nv(page)

    // копируем A1:B2
    await clickCell(page, 0, 0)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() =>
        page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'))),
      )
      .toBe('Фамилия\tОтдел\nИванов\tПродажи')

    // вставляем в E5 — пустая зона демо-листа
    await clickCell(page, 4, 4)
    await page.keyboard.press('Control+v')
    await expect.poll(() => api.cell(4, 4)).toBe('Фамилия')
    expect(await api.cell(4, 5)).toBe('Отдел')
    expect(await api.cell(5, 4)).toBe('Иванов')
    expect(await api.cell(5, 5)).toBe('Продажи')
    // выделение накрыло вставленный блок, активная — его левый верх
    expect(await api.ranges()).toEqual(['E5:F6'])
    expect(await api.activeRef()).toBe('E5')

    // Ctrl+Z откатывает блок одной транзакцией
    await page.keyboard.press('Control+z')
    await expect.poll(() => api.cell(4, 4)).toBe('')
    expect(await api.cell(5, 5)).toBe('')
  })

  test('копирование между двумя открытыми книгами: Ctrl+C в одной → Ctrl+V в другой', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    // вторая книга — вторая страница контекста: системный буфер у них общий,
    // как у двух окон десктоп-обёртки (карточка novagrid-025)
    const second = await page.context().newPage()
    await second.goto('/?test=1')
    await nv(second).ready()

    // книга 1: копируем C2:C4 — суммы демо-таблицы
    await clickCell(page, 1, 2)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() =>
        page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'))),
      )
      .toBe('10000\n12500\n8000')

    // книга 2: вставляем ниже демо-данных в колонку A
    await clickCell(second, 10, 0)
    await second.keyboard.press('Control+v')
    await expect.poll(() => nv(second).cell(10, 0)).toBe('10000')
    expect(await nv(second).cell(11, 0)).toBe('12500')
    expect(await nv(second).cell(12, 0)).toBe('8000')

    await second.close()
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

test.describe('прокрутка таблицы (novagrid-027)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1&stress=1000')
    await nv(page).ready()
  })

  test('колесо мыши прокручивает таблицу по вертикали и горизонтали', async ({ page }) => {
    const el = page.locator('.grid-scroll')
    await page.mouse.move(600, 400)
    await page.mouse.wheel(0, 480)
    await expect.poll(() => el.evaluate((n) => n.scrollTop)).toBeGreaterThan(400)
    await page.mouse.wheel(480, 0)
    await expect.poll(() => el.evaluate((n) => n.scrollLeft)).toBeGreaterThan(400)
  })

  test('Ctrl+End — последняя ячейка листа, Ctrl+Home — A1; кадр едет сам', async ({ page }) => {
    const api = nv(page)
    await page.click('.grid-area')
    await page.keyboard.press('Control+End')
    await expect.poll(() => api.activeRef()).toBe('AD1000') // 30-я колонка
    // прокрутка доехала до конца листа (глубина минус экран)
    await expect
      .poll(() => page.locator('.grid-scroll').evaluate((n) => n.scrollTop))
      .toBeGreaterThan(30 * 1000 - 30 * 40)
    await page.keyboard.press('Control+Home')
    await expect.poll(() => api.activeRef()).toBe('A1')
    await expect
      .poll(() => page.locator('.grid-scroll').evaluate((n) => n.scrollTop))
      .toBe(0)
  })
})

test.describe('ширины колонок мышью (novagrid-020)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  /** Координаты границы между колонками col-1 и col (в шапке, зум 100 %). */
  async function borderPoint(page: Page, col: number) {
    const box = await page.locator('.grid-area').boundingBox()
    const m = await page.evaluate(() => window.__nv!.cellMetrics())
    return { x: box!.x + m.rowHeaderW + col * m.colW, y: box!.y + m.headerH / 2 }
  }

  test('перетаскивание границы A|B расширяет A, соседние ячейки сдвигаются', async ({ page }) => {
    const api = nv(page)
    expect(await api.cell(1, 1)).toBe('Продажи') // B2 демо-листа

    const p = await borderPoint(page, 1)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 64, p.y, { steps: 6 })
    await page.mouse.up()

    // A стала 96 + 64 = 160, спейсер вырос на те же 64
    expect(await page.evaluate(() => window.__nv!.colWidth(0))).toBe(160)
    const spacerW = await page.evaluate(
      () => document.querySelector<HTMLElement>('.grid-spacer')?.style.width ?? '',
    )
    expect(spacerW).toBe(`${44 + 26 * 96 + 64}px`)

    // координаты хука учитывают новую ширину: клик по центру B2 попадает в B
    const b2 = await page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), {
      row: 1,
      col: 1,
    })
    await page.mouse.click(b2.x, b2.y)
    expect(await api.activeRef()).toBe('B2')
  })

  test('сужение и минимум: B сжимается до 32 px, дальше не тянется', async ({ page }) => {
    const p = await borderPoint(page, 2) // граница B|C меняет ширину B
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x - 300, p.y, { steps: 6 })
    await page.mouse.up()
    expect(await page.evaluate(() => window.__nv!.colWidth(1))).toBe(32)
  })

  test('клик по шапке у границы не открывает меню и не меняет выделение', async ({ page }) => {
    // край шапки — зона границы, а не кнопки ▾: без движения ничего не меняется
    const p = await borderPoint(page, 1)
    await page.mouse.click(p.x, p.y)
    await expect(page.locator('.col-menu')).toHaveCount(0)
    // выделение осталось исходным (A1), колонка не выделась
    expect(await nv(page).ranges()).toEqual(['A1:A1'])
  })
})
