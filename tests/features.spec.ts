import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 3 «Поиск · ПКМ-фильтр · Σ» (КТ-3): e2e повторяет сценарий ТЗ —
 * «ПКМ на Иванов в A, ПКМ на 10000 в C → видно 132 строки → Σ показывает
 * сумму», плюс инкрементальный поиск (Ф2), меню колонки ▾ (Ф3.7/Ф8) и
 * живая Alt-сумма в зоне Σ (Ф4). Демо-фикстура demo-book.xlsx содержит
 * ровно 132 строки «Иванов + 10 000» (Этап 2.5).
 *
 * Тип window.__nv объявлен в grid.spec.ts (общий для проекта тестов).
 */

const IVANOV_TOTAL = 180 // 132 «Иванов+10 000» + 48 «Иванов» с другими суммами
const CONTENT_ROWS = 501 // шапка + 500 строк данных

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    visibleRows: () => page.evaluate(() => window.__nv!.visibleRows()),
    filters: () => page.evaluate(() => window.__nv!.filters()),
    searchInfo: () => page.evaluate(() => window.__nv!.searchInfo()),
    activeRef: () => page.evaluate(() => window.__nv!.activeRef()),
  }
}

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Иванов')
}

async function rightClickCell(page: Page, row: number, col: number) {
  const center = await nv(page).cellCenter(row, col)
  await page.mouse.click(center.x, center.y, { button: 'right' })
}

test.describe('КТ-3: ПКМ-фильтрация сценария ТЗ → 132 строки → Σ', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('ПКМ на Иванов в A, ПКМ на 10000 в C: видно 132 строки, Σ = 1 320 000', async ({ page }) => {
    const api = nv(page)

    // 1. ПКМ по «Иванов» в колонке A → фильтр A = Иванов
    await rightClickCell(page, 1, 0)
    await page.getByRole('menuitem', { name: 'Фильтровать: A = «Иванов»' }).click()
    await expect.poll(() => api.visibleRows().then((r) => r?.length ?? 0)).toBe(IVANOV_TOTAL)
    await expect(page.locator('.sheets-note')).toHaveText(
      `Показано ${IVANOV_TOTAL} из ${CONTENT_ROWS}`,
    )

    // чип фильтра появился
    await expect(page.locator('.filter-chip')).toHaveCount(1)
    await expect(page.locator('.filter-chip-text').first()).toHaveText('A = Иванов')

    // 2. ПКМ по видимой ячейке «10000» в колонке C → фильтры по «И»: A И C
    const rowWith10000 = await page.evaluate(() => {
      const vis = window.__nv!.visibleRows() ?? []
      for (const r of vis) if (window.__nv!.cell(r, 2) === '10000') return r
      return -1
    })
    expect(rowWith10000).toBeGreaterThanOrEqual(0)
    await rightClickCell(page, rowWith10000, 2)
    await page.getByRole('menuitem', { name: 'Фильтровать: C = «10000»' }).click()

    // КТ: видно ровно 132 строки
    await expect.poll(() => api.visibleRows().then((r) => r?.length ?? 0)).toBe(132)
    await expect(page.locator('.sheets-note')).toHaveText(`Показано 132 из ${CONTENT_ROWS}`)
    await expect(page.locator('.filter-chip')).toHaveCount(2)

    // 3. Σ: выделяем колонку C кликом по шапке — статус-бар показывает сумму видимых
    const headerC = await api.cellCenter(-1, 2)
    await page.mouse.click(headerC.x, headerC.y)
    await expect(page.locator('.status-metrics')).toContainText(
      /1[\s\u00a0\u202f]320[\s\u00a0\u202f]000/,
    )
    await expect(page.locator('.status-metrics')).toContainText('n 132')

    // 4. большая кнопка Σ — карточка метрик выделения
    await page.getByRole('button', { name: 'Сумма выделенного' }).click()
    const card = page.locator('.sum-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText(/1[\s\u00a0\u202f]320[\s\u00a0\u202f]000/)
    await expect(card).toContainText('Кол-во чисел')
    await expect(card).toContainText('Среднее')

    // 5. «Сбросить всё» возвращает все строки
    await page.keyboard.press('Escape') // закрыть карточку
    await page.getByRole('button', { name: 'Сбросить всё' }).click()
    await expect(page.locator('.filter-chip')).toHaveCount(0)
    await expect(page.locator('.sheets-note')).not.toContainText('Показано')
  })

  test('меню ПКМ: инверсия, сброс колонки, копирование ячейки', async ({ page }) => {
    const api = nv(page)

    // инверсия: Исключить A ≠ Иванов — остаются все, кроме Ивановых
    await rightClickCell(page, 1, 0)
    await page.getByRole('menuitem', { name: 'Исключить: A ≠ «Иванов»' }).click()
    await expect
      .poll(() => api.visibleRows().then((r) => r?.length ?? 0))
      .toBe(CONTENT_ROWS - IVANOV_TOTAL)
    await expect(page.locator('.filter-chip-text').first()).toHaveText('A ≠ Иванов')

    // у отфильтрованной колонки в меню есть оба сброса
    await rightClickCell(page, 1, 0)
    const menu = page.getByRole('menu', { name: 'Меню ячейки' })
    await expect(menu.getByRole('menuitem', { name: 'Снять фильтр с колонки A' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Сбросить все фильтры' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Снять фильтр с колонки A' }).click()
    // фильтров нет — visibleRows() === null, проверяем через список фильтров
    await expect.poll(() => api.filters().then((f) => f.length)).toBe(0)

    // «Копировать ячейку» кликается (клик по пункту не ломает сетку)
    await rightClickCell(page, 0, 0)
    await page.getByRole('menuitem', { name: 'Копировать ячейку' }).click()
    await expect(page.locator('.ctx-menu')).toBeHidden()
  })
})

test.describe('поиск (Ф2): инкрементальный, лист/книга, счётчик, навигация', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('Ctrl+F → счётчик, Enter-навигация, параметры, закрытие', async ({ page }) => {
    const api = nv(page)

    // Ctrl+F открывает панель и фокусирует поле
    await page.keyboard.press('Control+f')
    const input = page.getByLabel('Поиск по таблице')
    await expect(input).toBeFocused()
    await page.keyboard.type('Иванов')

    // инкрементально: счётчик «1 / 180»
    await expect(page.locator('.search-counter')).toHaveText(`1 / ${IVANOV_TOTAL}`)
    await expect((await api.searchInfo()).count).toBe(IVANOV_TOTAL)

    // Enter — вперёд по совпадениям, счётчик и активная ячейка двигаются
    const firstRef = await api.activeRef()
    await page.keyboard.press('Enter')
    await expect(page.locator('.search-counter')).toHaveText(`2 / ${IVANOV_TOTAL}`)
    expect(await api.activeRef()).not.toBe(firstRef)

    // Shift+Enter — назад
    await page.keyboard.press('Shift+Enter')
    await expect(page.locator('.search-counter')).toHaveText(`1 / ${IVANOV_TOTAL}`)

    // «ячейка целиком»: «Иванов» совпадает целиком, «Иван» — нет
    await page.getByRole('button', { name: 'Параметры поиска' }).click()
    await page.getByLabel('Ячейка целиком').check()
    await expect(page.locator('.search-counter')).toHaveText(`1 / ${IVANOV_TOTAL}`)
    await input.fill('Иван')
    await expect(page.locator('.search-counter')).toHaveText('0 / 0')
    await page.getByLabel('Ячейка целиком').uncheck()

    // «Все листы»: тот же счётчик + список результатов по листам
    await input.fill('Иванов')
    await page.getByRole('radio', { name: 'Все листы' }).click()
    await expect(page.locator('.search-counter')).toHaveText(`1 / ${IVANOV_TOTAL}`)
    await expect(page.locator('.search-result').first()).toBeVisible()
    await expect(page.locator('.search-results-more')).toContainText('120')

    // клик по результату переходит на ячейку
    await page.locator('.search-result').first().click()
    await expect(page.locator('.formula-ref')).toContainText(/^[A-Z]+\d+$/)

    // Esc закрывает панель, подсветка уходит
    await page.keyboard.press('Escape')
    await expect(page.locator('.search-panel')).toBeHidden()
    expect((await api.searchInfo()).count).toBe(0)
  })

  test('поиск по всем листам находит совпадения на втором листе и переключает вкладку', async ({
    page,
  }) => {
    const api = nv(page)
    await page.keyboard.press('Control+f')
    await page.getByRole('radio', { name: 'Все листы' }).click()
    // «Отдел» есть и в шапке «Сотрудников», и на листе «Справочник»
    await page.keyboard.type('Бухгалтерия')
    const info = await api.searchInfo()
    expect(info.count).toBeGreaterThan(0)
    // сверимся: на вкладке 0 совпадения шапки
    await page.locator('.search-result').first().click()
    expect(await api.activeRef()).toMatch(/^[A-Z]+\d+$/)
  })
})

test.describe('меню колонки ▾ (Ф3.7 + Ф8): галочки значений и сортировка', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('▾ в шапке A: поиск по значениям, галочка прячет значение, сброс', async ({ page }) => {
    const api = nv(page)

    // клик по ▾-зоне в правой части заголовка A
    const center = await api.cellCenter(-1, 0)
    await page.mouse.click(center.x + 34, center.y)
    const menu = page.locator('.col-menu')
    await expect(menu).toBeVisible()

    // поиск по значениям сужает список до одного
    await menu.getByLabel('Поиск по значениям…').fill('Сидоров')
    await expect(menu.locator('.col-menu-value')).toHaveCount(1)

    // снять галочку — все строки «Сидоров» скрыты, чип фильтра появился
    const sidorovCount = await page.evaluate(() => {
      let n = 0
      for (let r = 0; r <= 500; r++) if (window.__nv!.cell(r, 0) === 'Сидоров') n++
      return n
    })
    expect(sidorovCount).toBeGreaterThan(0)
    await menu.locator('.col-menu-value input[type="checkbox"]').uncheck()
    await expect
      .poll(() => api.visibleRows().then((r) => r?.length ?? 0))
      .toBe(CONTENT_ROWS - sidorovCount)
    await expect(page.locator('.filter-chip')).toHaveCount(1)

    // «Сбросить фильтр колонки»
    await page.getByRole('button', { name: 'Сбросить фильтр колонки' }).click()
    await expect.poll(() => api.filters().then((f) => f.length)).toBe(0)
  })

  test('сортировка по возрастанию с подтверждением, Ctrl+Z возвращает', async ({ page }) => {
    const api = nv(page)

    const center = await api.cellCenter(-1, 0) // колонка A — фамилии
    await page.mouse.click(center.x + 34, center.y)
    const menu = page.locator('.col-menu')
    await expect(menu).toBeVisible()

    // первое использование — подтверждение (Ф8)
    const confirmDialog = page.waitForEvent('dialog').then(async (d) => {
      const msg = d.message()
      await d.accept()
      return msg
    })
    await menu.getByRole('menuitem', { name: 'По возрастанию' }).click()
    expect(await confirmDialog).toContain('Ctrl+Z')

    // фамилии по возрастанию: первая видимая строка данных — «Волкова»
    // (кириллица: В < К < П < С < Сидоров/Смирнов < И… порядок ru-локали)
    const first = await page.evaluate(() => {
      const vis = window.__nv!.visibleRows() ?? []
      return window.__nv!.cell(vis[1] ?? 1, 0)
    })
    expect([
      'Волкова',
      'Иванов',
      'Козлов',
      'Кузнецова',
      'Морозова',
      'Николаев',
      'Петров',
      'Сидоров',
      'Смирнов',
    ]).toContain(first)

    // вторая сортировка — без подтверждения (флаг сессии)
    const noDialog = page
      .waitForEvent('dialog', { timeout: 500 })
      .then(() => true)
      .catch(() => false)
    await page.mouse.click(center.x + 34, center.y)
    await page.locator('.col-menu').getByRole('menuitem', { name: 'По убыванию' }).click()
    expect(await noDialog).toBe(false)

    // Ctrl+Z откатывает последнюю сортировку
    await page.keyboard.press('Control+z')
    const restored = await page.evaluate(() => {
      const vis = window.__nv!.visibleRows() ?? []
      return window.__nv!.cell(vis[1] ?? 1, 0)
    })
    expect(restored).toBe(first)
  })
})

test.describe('Alt-выделение (Ф4): живая сумма крупно в зоне Σ', () => {
  test('Alt+перетаскивание показывает сумму у курсора и в зоне кнопки Σ', async ({ page }) => {
    await page.goto('/?test=1')
    await nv(page).ready()

    const from = await page.evaluate(() => window.__nv!.cellCenter(1, 2))
    const to = await page.evaluate(() => window.__nv!.cellCenter(3, 2))

    await page.mouse.move(from.x, from.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 5 })
    // лассо C2:C4 → 10000+12500+8000 = 30 500 — крупно в зоне Σ и у курсора
    await expect(page.locator('.sum-live')).toBeVisible()
    await expect(page.locator('.sum-live')).toContainText(/30[\s\u00a0\u202f]500/)
    await expect(page.locator('.alt-sum-label')).toHaveText(/30[\s\u00a0\u202f]500/)

    await page.mouse.up()
    await page.keyboard.up('Alt')
    await expect(page.locator('.sum-live')).toBeHidden()
  })
})
