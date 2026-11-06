import { expect, test, type Page } from '@playwright/test'
import { colName } from '../src/grid/geometry'
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
    freeze: () => page.evaluate(() => window.__nv!.freeze()),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    cellMetrics: () => page.evaluate(() => window.__nv!.cellMetrics()),
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

    // клик по таблице при открытом меню только гасит его (novagrid-061) —
    // первый клик по шапке закрывает меню, второй выделяет колонку B
    await clickCell(page, -1, 1)
    await expect(page.locator('.ctx-menu')).toBeHidden()
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

test.describe('пустое место для вставки (novagrid-032)', () => {
  test('прокрутка к краю расширяет лист — место есть всегда', async ({ page }) => {
    await page.goto('/?test=1&stress=1000')
    await nv(page).ready()
    const book = () => page.evaluate(() => window.__nv!.book())

    // после загрузки за данными уже запас пустых строк (1000 → 1050)
    await expect.poll(() => book().then((b) => b.rows)).toBe(1050)

    // доехали до низа — лист подрос ещё блоком (и дальше так же)
    await nv(page).scrollTo(0, 10 ** 9)
    await expect.poll(() => book().then((b) => b.rows)).toBe(1100)

    // правый край — колонки растут так же (30 → 40)
    await nv(page).scrollTo(10 ** 9, 0)
    await expect.poll(() => book().then((b) => b.cols)).toBe(40)
  })

  test('скопированный блок вставляется в пустые ячейки под данными', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/?test=1')
    await nv(page).ready()
    const api = nv(page)

    // блок A1:B2 демо-таблицы → буфер
    await clickCell(page, 0, 0)
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Control+c')
    await expect
      .poll(() =>
        page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'))),
      )
      .toBe('Фамилия\tОтдел\nИванов\tПродажи')

    // пустое место под данными: строка 12 кликается и принимает блок
    await api.scrollTo(0, 30 * 11 - 120)
    await clickCell(page, 11, 0)
    await page.keyboard.press('Control+v')
    await expect.poll(() => api.cell(11, 0)).toBe('Фамилия')
    expect(await api.cell(12, 1)).toBe('Продажи')
    expect(await api.ranges()).toEqual(['A12:B13'])
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
    // лист = данные (1000) + запас пустых строк (novagrid-032); 30-я колонка
    await expect.poll(() => api.activeRef()).toBe('AD1050')
    // прокрутка доехала до конца данных (глубина минус экран)
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

test.describe('пустое место за границей листа (novagrid-035)', () => {
  test.beforeEach(async ({ page }) => {
    // широкое окно: за узким листом остаётся заметная полоса «пустого места»
    await page.setViewportSize({ width: 1600, height: 800 })
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  test('за последней колонкой узкого листа сетка и буквы идут до края окна', async ({ page }) => {
    // у всех листов минимум 26 колонок (MIN_COLS) — при зуме 100 % они накрывают
    // окно целиком и «обрыва» не видно. Отдаляем таблицу до 50 % (Ctrl+«−»):
    // 26·48 + 44 = 1292 px контента, за ним — зона заполнителя до края окна.
    // Это же видно на мониторах шире 2540 px без зума.
    await clickCell(page, 0, 0) // фокус на грид — зум слушает клавиатуру грида
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+Minus')
    // зум 50 %: колонка 96 → 48 px (проверка без float-хвостов)
    await expect
      .poll(() => page.evaluate(() => window.__nv!.cellMetrics().colW), { timeout: 3000 })
      .toBe(48)

    const geom = await page.evaluate(() => {
      const m = window.__nv!.cellMetrics()
      const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
      return { m, cols: window.__nv!.book().cols, canvasW: canvas.getBoundingClientRect().width }
    })
    const contentRight = geom.m.rowHeaderW + geom.cols * geom.m.colW
    // за краем контента видно минимум две колонки заполнителя
    expect(geom.canvasW - contentRight).toBeGreaterThanOrEqual(2 * geom.m.colW)

    // (1) в теле таблицы за краем есть вертикальные линии сетки (не чистый фон)
    const linePixels = await page.evaluate(
      ({ x0, w, y }) => {
        const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
        const ctx = canvas.getContext('2d')!
        const dpr = window.devicePixelRatio || 1
        const data = ctx.getImageData(
          Math.round(x0 * dpr),
          Math.round(y * dpr),
          Math.round(w * dpr),
          1,
        ).data
        let nonBg = 0
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonBg++
        return nonBg
      },
      { x0: contentRight + 2, w: geom.canvasW - contentRight - 4, y: geom.m.headerH + 2.5 * geom.m.rowH },
    )
    expect(linePixels).toBeGreaterThan(0)

    // (2) в шапке заполнителя нарисованы буквы колонок (тёмные чернила на surface)
    const inkPixels = await page.evaluate(
      ({ x0, w, y0, h }) => {
        const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
        const ctx = canvas.getContext('2d')!
        const dpr = window.devicePixelRatio || 1
        const data = ctx.getImageData(
          Math.round(x0 * dpr),
          Math.round(y0 * dpr),
          Math.round(w * dpr),
          Math.round(h * dpr),
        ).data
        let ink = 0
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) ink++
        return ink
      },
      {
        x0: contentRight + 4,
        w: geom.m.colW - 8,
        y0: 4,
        h: geom.m.headerH - 8,
      },
    )
    expect(inkPixels).toBeGreaterThan(3)

    // (3) клик по заполнителю не уводит выделение за логическую границу листа
    const box = await page.locator('.grid-area').boundingBox()
    await page.mouse.click(
      box!.x + contentRight + geom.m.colW / 2,
      box!.y + geom.m.headerH + 3 * geom.m.rowH + geom.m.rowH / 2,
    )
    // последняя реальная колонка листа (M для демо-книги 13 колонок)
    expect(await nv(page).activeRef()).toBe(`${colName(geom.cols - 1)}4`)
  })
})

test.describe('ширина колонки до 1000 px (novagrid-035)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  test('растяжение дальше 400 упирается в новый предел 1000 px', async ({ page }) => {
    const box = await page.locator('.grid-area').boundingBox()
    const m = await page.evaluate(() => window.__nv!.cellMetrics())
    const x = box!.x + m.rowHeaderW + m.colW // граница A|B
    const y = box!.y + m.headerH / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 1200, y, { steps: 20 }) // 96 + 1200 → кламп 1000
    await page.mouse.up()
    expect(await page.evaluate(() => window.__nv!.colWidth(0))).toBe(1000)
  })
})

test.describe('протяжка выделения от шапки (novagrid-038)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  /** Центр номера строки row и заголовка колонки col. */
  async function headerPoints(page: Page, row: number, col: number) {
    const box = await page.locator('.grid-area').boundingBox()
    const m = await page.evaluate(() => window.__nv!.cellMetrics())
    const cell = await page.evaluate(
      ({ row, col }) => window.__nv!.cellCenter(row, col),
      { row, col },
    )
    return {
      rowHeader: { x: box!.x + m.rowHeaderW / 2, y: cell.y },
      colHeader: { x: cell.x, y: box!.y + m.headerH / 2 },
    }
  }

  test('тяну за номера строк вниз — выделяются строки целиком, Σ живая', async ({ page }) => {
    const api = nv(page)
    const from = await headerPoints(page, 1, 0)
    const to = await headerPoints(page, 3, 0)

    await page.mouse.move(from.rowHeader.x, from.rowHeader.y)
    await page.mouse.down()
    await page.mouse.move(to.rowHeader.x, to.rowHeader.y, { steps: 5 })
    await page.mouse.up()

    // строки 2–4 на всю ширину листа (26 колонок → Z)
    expect(await api.ranges()).toEqual(['A2:Z4'])
    expect((await api.activeRef())).toBe('A2')
    // Σ считает числа выделенных строк: 10000+12500+8000
    const m = await api.metrics()
    expect(m.total).toBe(30500)
    expect(m.count).toBe(3)
  })

  test('тяну вверх — охват от якоря до курсора; колонки тоже тянутся', async ({ page }) => {
    const api = nv(page)
    const bottom = await headerPoints(page, 3, 0)
    const top = await headerPoints(page, 1, 0)

    await page.mouse.move(bottom.rowHeader.x, bottom.rowHeader.y)
    await page.mouse.down()
    await page.mouse.move(top.rowHeader.x, top.rowHeader.y, { steps: 5 })
    await page.mouse.up()
    expect(await api.ranges()).toEqual(['A2:Z4'])

    // колонки B..D на всю высоту (100 строк демо-листа)
    const b = await headerPoints(page, 0, 1)
    const d = await headerPoints(page, 0, 3)
    await page.mouse.move(b.colHeader.x, b.colHeader.y)
    await page.mouse.down()
    await page.mouse.move(d.colHeader.x, d.colHeader.y, { steps: 5 })
    await page.mouse.up()
    expect(await api.ranges()).toEqual(['B1:D100'])
  })
})

test.describe('закрепление областей (novagrid-044)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  test('«Закрепить области» до B2: шапка стоит при прокрутке, клик честный, «Снять» возвращает', async ({
    page,
  }) => {
    const api = nv(page)

    // закреп выше и левее активной B2: первая строка и колонка A
    await clickCell(page, 1, 1, { button: 'right' })
    await page
      .getByRole('menuitem', { name: 'Закрепить области (выше и левее активной ячейки)' })
      .click()
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })

    // закреплённая A1 не едет при прокрутке и остаётся в отрисовке
    const a1 = await api.cellCenter(0, 0)
    await api.scrollTo(0, 2000)
    expect((await api.cellCenter(0, 0)).y).toBe(a1.y)
    // кадр по rAF: прокручиваемая область уехала (firstRow > закрепа),
    // а закреплённая A1 осталась на месте и кликабельна
    await page.waitForTimeout(100)
    expect((await api.visible())?.firstRow).toBeGreaterThan(1)

    // клик в экранную точку закрепа выбирает A1, а не прокрученную ячейку
    await page.mouse.click(a1.x, a1.y)
    expect(await api.activeRef()).toBe('A1')

    // снятие: тот же экранный клик теперь попадает в прокрученные данные
    await page.mouse.click(a1.x, a1.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Снять закрепление' }).click()
    expect(await api.freeze()).toEqual({ rows: 0, cols: 0 })
    await page.mouse.click(a1.x, a1.y)
    expect(await api.activeRef()).not.toBe('A1')
  })

  test('клавиатура не теряет закреп: стрелки из глубины листа доходят до шапки', async ({
    page,
  }) => {
    const api = nv(page)
    await clickCell(page, 1, 1, { button: 'right' })
    await page
      .getByRole('menuitem', { name: 'Закрепить области (выше и левее активной ячейки)' })
      .click()
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })

    // из глубины листа стрелки доводят выделение до закрепа; закреп видим всегда
    await clickCell(page, 2, 2)
    for (let i = 0; i < 80; i++) await page.keyboard.press('ArrowDown')
    expect(await api.activeRef()).toBe('C83')
    for (let i = 0; i < 90; i++) await page.keyboard.press('ArrowUp')
    expect(await api.activeRef()).toBe('C1')
    // закреплённая строка 1 на экране: центр C1 внутри канваса, у второй строки ниже
    const box = await page.locator('.grid-area').boundingBox()
    const c1 = await api.cellCenter(0, 2)
    const c2 = await api.cellCenter(1, 2)
    expect(c1.y).toBeGreaterThan(box!.y)
    expect(c2.y).toBeGreaterThan(c1.y)
  })
})

test.describe('вставка/удаление строк и колонок (novagrid-045)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()
  })

  /** ПКМ по номеру строки row (центр шапки строки, как headerPoints выше). */
  async function rightClickRowHeader(page: Page, row: number) {
    const api = nv(page)
    const box = await page.locator('.grid-area').boundingBox()
    const m = await api.cellMetrics()
    const cell = await api.cellCenter(row, 0)
    await page.mouse.click(box!.x + m.rowHeaderW / 2, cell.y, { button: 'right' })
  }

  test('ПКМ по шапке строки: вставить выше, Ctrl+Z откатывает, удалить строку', async ({
    page,
  }) => {
    const api = nv(page)
    expect(await api.cell(2, 0)).toBe('Петров')

    await rightClickRowHeader(page, 2)
    await page.getByRole('menuitem', { name: 'Вставить строку выше' }).click()
    expect(await api.cell(2, 0)).toBe('')
    expect(await api.cell(3, 0)).toBe('Петров')

    await page.keyboard.press('Control+z')
    expect(await api.cell(2, 0)).toBe('Петров')
    expect(await api.cell(3, 0)).toBe('Сидоров')

    // грид дедуплицирует ПКМ в одной точке короче 400 мс (Android long-press):
    // ждём, чтобы второй вызов меню строки не был съеден guard-ом
    await page.waitForTimeout(450)

    await rightClickRowHeader(page, 2)
    await page.getByRole('menuitem', { name: 'Удалить строку' }).click()
    expect(await api.cell(2, 0)).toBe('Сидоров')
  })

  test('ПКМ по шапке колонки: вставить слева, формулы едут с данными, Ctrl+Z возвращает', async ({
    page,
  }) => {
    const api = nv(page)

    await clickCell(page, -1, 2, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Вставить колонку слева' }).click()
    expect(await api.cell(1, 3)).toBe('10000') // C уехала в D
    expect(await api.cell(1, 2)).toBe('')

    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 2)).toBe('10000')
  })
})
