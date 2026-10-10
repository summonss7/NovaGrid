import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 7 «Найти и заменить» (карточка novagrid-013): e2e повторяет сценарий
 * готовности — «нашёл → заменил все → значения обновились → Ctrl+Z вернул
 * всё» на одном листе и по книге (второй лист добавляется кнопкой «+»,
 * батч по книге откатывается ОДНИМ Ctrl+Z). Плюс: «Заменить» по одному,
 * режим «искать в формулах» с пересчётом, замена под include-фильтром
 * пересчитывает RowLayout (строки с новым значением скрываются, Ctrl+Z
 * возвращает), Σ/статус-бар видят новые значения.
 *
 * Демо-режим ?test=1: 7×3 — «Продажи» в B2/B4/B7, «Логистика» в B3/B6,
 * числа C2…C7. Тип window.__nv объявлен в grid.spec.ts.
 */

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellText: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellText(row, col), { row, col }),
    cellIn: (tab: number, row: number, col: number) =>
      page.evaluate(({ tab, row, col }) => window.__nv!.cellIn(tab, row, col), { tab, row, col }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    visibleRows: () => page.evaluate(() => window.__nv!.visibleRows()),
    metrics: () => page.evaluate(() => window.__nv!.metrics()),
    activeRef: () => page.evaluate(() => window.__nv!.activeRef()),
    replaceInfo: () => page.evaluate(() => window.__nv!.replaceInfo()),
    formulaInfo: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.formulaInfo(row, col), { row, col }),
  }
}

async function openDemo(page: Page) {
  await page.goto('/?test=1')
  await nv(page).ready()
}

/** Клик мышью по центру ячейки (координаты — у грида, как в grid.spec.ts). */
async function clickCell(page: Page, row: number, col: number, button: 'left' | 'right' = 'left') {
  const c = await nv(page).cellCenter(row, col)
  await page.mouse.click(c.x, c.y, { button })
}

/** Открыть Ctrl+H и набрать запрос/замену; ждёт живой счётчик «Найдено: N». */
async function openReplace(page: Page, query: string, replacement = '', found: number | null = null) {
  await page.keyboard.press('Control+h')
  const dialog = page.getByRole('dialog', { name: 'Найти и заменить' })
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Найти', { exact: true })).toBeFocused()
  await page.keyboard.type(query)
  if (replacement !== '') await page.getByLabel('Заменить на').fill(replacement)
  if (found !== null) await expect(page.locator('.replace-counter')).toHaveText(`Найдено: ${found}`)
  return dialog
}

test.describe('Этап 7: «Заменить все» на листе → Ctrl+Z вернул всё', () => {
  test.beforeEach(async ({ page }) => openDemo(page))

  test('нашёл → заменил все → значения обновились → один Ctrl+Z вернул всё', async ({ page }) => {
    const api = nv(page)

    await openReplace(page, 'Продажи', 'Сбыт', 3)
    await page.getByRole('button', { name: 'Заменить все' }).click()

    // счётчик действия + значения обновились (B2/B4/B7), сосед не тронут
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 3')
    expect(await api.cell(1, 1)).toBe('Сбыт')
    expect(await api.cell(3, 1)).toBe('Сбыт')
    expect(await api.cell(6, 1)).toBe('Сбыт')
    expect(await api.cell(2, 1)).toBe('Логистика')
    // заменённое больше не совпадает — «Найдено» обнулилось
    expect((await api.replaceInfo()).count).toBe(0)

    // ОДИН Ctrl+Z — весь батч вернулся
    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 1)).toBe('Продажи')
    expect(await api.cell(3, 1)).toBe('Продажи')
    expect(await api.cell(6, 1)).toBe('Продажи')

    // Esc закрывает диалог; повторный Ctrl+H помнит прошлый запрос
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Найти и заменить' })).toBeHidden()
    await page.keyboard.press('Control+h')
    await expect(page.getByLabel('Найти', { exact: true })).toHaveValue('Продажи')
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 3')
  })

  test('Σ/статус-бар видят новые значения (10000 → 20000 и назад)', async ({ page }) => {
    const api = nv(page)

    await clickCell(page, 1, 2)
    expect((await api.metrics()).total).toBe(10000)

    await openReplace(page, '10000', '20000', 1)
    await page.getByRole('button', { name: 'Заменить все' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 1')

    expect(await api.cell(1, 2)).toBe('20000')
    expect((await api.metrics()).total).toBe(20000)
    await expect(page.locator('.status-metrics')).toContainText(/20[\s\u00a0\u202f]000/)

    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 2)).toBe('10000')
    expect((await api.metrics()).total).toBe(10000)
  })
})

test.describe('Этап 7: «Заменить все» по книге — один Ctrl+Z откатывает оба листа', () => {
  test.beforeEach(async ({ page }) => openDemo(page))

  // ввод в ячейку нового листа — ASCII («10000»): Playwright набирает
  // кириллицу через insertText без keydown, редактор ячейки не открылся бы
  test('второй лист добавлен кнопкой «+»: нашёл 2 → заменил 2 → Ctrl+Z вернул оба', async ({
    page,
  }) => {
    const api = nv(page)

    // второй лист с «10000» в A1: совпадения — C2 первого листа + A1 нового
    await page.getByRole('button', { name: 'Добавить лист' }).click()
    await clickCell(page, 0, 0)
    await page.keyboard.type('10000')
    await page.keyboard.press('Enter')
    expect(await api.cellIn(1, 0, 0)).toBe('10000')

    await openReplace(page, '10000', '20000')
    // до переключения области — «Этот лист»: на активном втором листе одно
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 1')
    await page.getByRole('radio', { name: 'Все листы' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 2')

    await page.getByRole('button', { name: 'Заменить все' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 2')
    expect(await api.cellIn(0, 1, 2)).toBe('20000') // C2 первого листа
    expect(await api.cellIn(1, 0, 0)).toBe('20000') // A1 второго листа
    expect(await api.cellIn(0, 2, 2)).toBe('12500') // не совпало — не тронуто

    // один Ctrl+Z на активном (втором) листе вернул замены на ОБОИХ листах
    await page.keyboard.press('Control+z')
    expect(await api.cellIn(0, 1, 2)).toBe('10000')
    expect(await api.cellIn(1, 0, 0)).toBe('10000')
  })

  test('область «Этот лист»: замена не выходит за активный лист', async ({ page }) => {
    const api = nv(page)

    await page.getByRole('button', { name: 'Добавить лист' }).click()
    await clickCell(page, 0, 0)
    await page.keyboard.type('10000')
    await page.keyboard.press('Enter')

    // область по умолчанию — «Этот лист»: найдено только A1 второго листа
    await openReplace(page, '10000', '20000', 1)
    await page.getByRole('button', { name: 'Заменить все' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 1')
    expect(await api.cellIn(1, 0, 0)).toBe('20000')
    expect(await api.cellIn(0, 1, 2)).toBe('10000') // первый лист не тронут
  })
})

test.describe('Этап 7: «Заменить» по одному + параметры', () => {
  test.beforeEach(async ({ page }) => openDemo(page))

  test('серия «Заменить» проходит каждое совпадение ровно один раз', async ({ page }) => {
    const api = nv(page)

    await openReplace(page, 'Продажи', 'Сбыт', 3)
    // Enter шагает по совпадениям (навигация как у поиска), Shift+Enter — назад
    const firstRef = await api.activeRef()
    await page.keyboard.press('Enter')
    expect(await api.activeRef()).not.toBe(firstRef) // B4 — второе совпадение
    await page.keyboard.press('Shift+Enter')
    expect(await api.activeRef()).toBe('B2') // вернулись к первому

    const replace = page.getByRole('button', { name: 'Заменить', exact: true })
    await replace.click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 1')
    expect(await api.cell(1, 1)).toBe('Сбыт')
    expect((await api.replaceInfo()).count).toBe(2)

    await replace.click()
    await replace.click()
    expect(await api.cell(3, 1)).toBe('Сбыт')
    expect(await api.cell(6, 1)).toBe('Сбыт')
    expect((await api.replaceInfo()).count).toBe(0)
    await expect(replace).toBeDisabled()
  })

  test('«Учитывать регистр» и «Ячейка целиком» сужают совпадения', async ({ page }) => {
    // целиком: «Продажи» есть, «Логистика» не равна запросу
    await openReplace(page, 'Продажи', 'X', 3)
    await page.getByLabel('Ячейка целиком').check()
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 3')
    await page.getByLabel('Ячейка целиком').uncheck()

    // регистр: «продажи» с маленькой буквы в демо-данных нет
    await page.getByLabel('Найти', { exact: true }).fill('продажи')
    await page.getByLabel('Учитывать регистр').check()
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 0')
    await page.getByLabel('Учитывать регистр').uncheck()
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 3')
  })
})

test.describe('Этап 7: режим «искать в формулах» (замена с пересчётом)', () => {
  test.beforeEach(async ({ page }) => openDemo(page))

  test('по умолчанию заменяется значение (формула становится статикой), Ctrl+Z возвращает', async ({ page }) => {
    const api = nv(page)

    await clickCell(page, 1, 3)
    await page.keyboard.type('=C2*2') // 10000*2 = 20000
    await page.keyboard.press('Enter')
    expect(await api.cellText(1, 3)).toBe('20000')

    await openReplace(page, '20000', '21000', 1)
    await page.getByRole('button', { name: 'Заменить все' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 1')
    expect(await api.cell(1, 3)).toBe('21000') // статическое значение
    expect(await api.formulaInfo(1, 3)).toBeNull() // формула снята

    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 3)).toBe('=C2*2') // формула вернулась
  })

  test('«Искать в формулах»: меняется текст формулы, движок пересчитывает', async ({ page }) => {
    const api = nv(page)

    await clickCell(page, 1, 3)
    await page.keyboard.type('=C2*2')
    await page.keyboard.press('Enter')
    expect(await api.cellText(1, 3)).toBe('20000')

    await openReplace(page, 'C2', 'C3', 0)
    await page.getByLabel('Искать в формулах').check()
    await expect(page.locator('.replace-counter')).toHaveText('Найдено: 1') // текст формулы

    await page.getByLabel('Заменить на').fill('C3')
    await page.getByRole('button', { name: 'Заменить все' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 1')
    expect(await api.cell(1, 3)).toBe('=C3*2') // осталась формулой
    expect(await api.cellText(1, 3)).toBe('25000') // пересчитано: 12500*2

    await page.keyboard.press('Control+z')
    expect(await api.cell(1, 3)).toBe('=C2*2')
    expect(await api.cellText(1, 3)).toBe('20000')
  })
})

test.describe('Этап 7: замена и фильтры (RowLayout пересчитывается)', () => {
  test.beforeEach(async ({ page }) => openDemo(page))

  test('под include-фильтром замена скрывает строки с новым значением, Ctrl+Z возвращает', async ({ page }) => {
    const api = nv(page)

    await clickCell(page, 1, 1, 'right')
    await page.getByRole('menuitem', { name: 'Фильтровать: B = «Продажи»' }).click()
    await expect.poll(() => api.visibleRows().then((r) => r?.join(','))).toBe('1,3,6')

    await openReplace(page, 'Продажи', 'Сбыт', 3)
    await page.getByRole('button', { name: 'Заменить все' }).click()
    await expect(page.locator('.replace-counter')).toHaveText('Заменено: 3')

    // новое значение не входит в include-список — строки скрылись (RowLayout)
    await expect.poll(() => api.visibleRows().then((r) => r?.join(','))).toBe('')
    expect(await api.cell(1, 1)).toBe('Сбыт') // значение в модели на месте

    await page.keyboard.press('Control+z')
    await expect.poll(() => api.visibleRows().then((r) => r?.join(','))).toBe('1,3,6')
    expect(await api.cell(1, 1)).toBe('Продажи')
  })
})
