import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 7.4 «Печатные формы» (КТ): печатная страница собирается по модели
 * книги (не скриншот канваса) — в print-среде есть данные и повторяемая
 * шапка, интерфейс приложения скрыт. Сценарий ТЗ: фильтр «Иванов + 10000» →
 * печать показывает ровно 132 отфильтрованные строки. Диалог настроек
 * (Ctrl+P / «⋯»): что печатать (видимые/весь лист), ориентация, формат;
 * «Печать…» вызывает window.print() — здесь он стаб, чтобы не открывать
 * системный предпросмотр.
 */

const IVANOV_10000 = 132 // строк сценария ТЗ в demo-book.xlsx
const CONTENT_ROWS = 501 // шапка + 500 строк данных

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    visibleRows: () => page.evaluate(() => window.__nv!.visibleRows()),
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

/** Фильтры сценария ТЗ: ПКМ «Иванов» в A, ПКМ «10000» в C → 132 строки. */
async function applySpecFilters(page: Page) {
  await rightClickCell(page, 1, 0)
  await page.getByRole('menuitem', { name: 'Фильтровать: A = «Иванов»' }).click()
  await expect.poll(() => nv(page).visibleRows().then((r) => r?.length ?? 0)).toBe(180)
  const rowWith10000 = await page.evaluate(() => {
    const vis = window.__nv!.visibleRows() ?? []
    for (const r of vis) if (window.__nv!.cell(r, 2) === '10000') return r
    return -1
  })
  await rightClickCell(page, rowWith10000, 2)
  await page.getByRole('menuitem', { name: 'Фильтровать: C = «10000»' }).click()
  await expect.poll(() => nv(page).visibleRows().then((r) => r?.length ?? 0)).toBe(IVANOV_10000)
}

async function stubPrint(page: Page) {
  await page.evaluate(() => {
    window.print = () => {
      const w = window as typeof window & { __nvPrintCalls?: number }
      w.__nvPrintCalls = (w.__nvPrintCalls ?? 0) + 1
    }
  })
}

const printCalls = (page: Page) =>
  page.evaluate(() => (window as typeof window & { __nvPrintCalls?: number }).__nvPrintCalls ?? 0)

test.describe('диалог печати: Ctrl+P, настройки, window.print', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
    await stubPrint(page)
  })

  test('Ctrl+P открывает диалог с настройками по умолчанию; «Печать…» печатает', async ({
    page,
  }) => {
    await page.keyboard.press('Control+p')
    const dlg = page.getByRole('dialog', { name: 'Печать' })
    await expect(dlg).toBeVisible()

    // без фильтров видимые строки == весь лист; по умолчанию альбомная и A4
    await expect(dlg.getByLabel(`Видимые строки (${CONTENT_ROWS} из ${CONTENT_ROWS})`)).toBeChecked()
    await expect(dlg.getByLabel(`Весь лист (${CONTENT_ROWS})`)).not.toBeChecked()
    await expect(dlg.getByLabel('Ориентация')).toHaveValue('landscape')
    await expect(dlg.getByLabel('Формат бумаги')).toHaveValue('a4')

    // «Печать…» применяет опции и вызывает window.print (стаб)
    await dlg.getByRole('button', { name: 'Печать…' }).click()
    await expect(dlg).toBeHidden()
    expect(await printCalls(page)).toBe(1)
  })

  test('Esc закрывает диалог без печати', async ({ page }) => {
    await page.keyboard.press('Control+p')
    const dlg = page.getByRole('dialog', { name: 'Печать' })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toBeHidden()
    expect(await printCalls(page)).toBe(0)
  })
})

test.describe('печатная страница (media=print): данные есть, UI скрыт', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('сценарий ТЗ: фильтр «Иванов + 10000» → печать показывает 132 строки', async ({ page }) => {
    await applySpecFilters(page)
    await page.emulateMedia({ media: 'print' })

    // печатается DOM-таблица по модели: 132 строки данных + шапка колонок
    const table = page.locator('.print-table')
    await expect(table).toBeVisible()
    await expect(table.locator('tbody tr')).toHaveCount(IVANOV_10000)
    await expect(table.locator('thead th')).toHaveText(['', 'A', 'B', 'C', 'D'])

    // заголовки строк — модельные номера, выровнены в узкой колонке
    await expect(table.locator('tbody tr').first().locator('th')).toHaveText(/\d+/)

    // данные отфильтрованы и локализованы: фамилия + сумма с разделителем
    const firstRow = table.locator('tbody tr').first()
    await expect(firstRow.locator('td').first()).toHaveText('Иванов')
    await expect(firstRow.locator('td').nth(2)).toHaveText(/10[\s\u00a0\u202f]000/)

    // колонтитул: чипы фильтров и «Показано 132 из 501»
    const head = page.locator('.print-head')
    await expect(head).toBeVisible()
    await expect(head).toContainText('A = Иванов')
    await expect(head).toContainText('C = 10000')
    await expect(head).toContainText(`Показано ${IVANOV_10000} из ${CONTENT_ROWS}`)

    // интерфейс приложения на печати скрыт: тулбар, канвас, статус-бар
    await expect(page.locator('.toolbar')).toBeHidden()
    await expect(page.locator('.grid-area')).toBeHidden()
    await expect(page.locator('.status-bar')).toBeHidden()
    await expect(page.locator('.sheets-bar')).toBeHidden()
  })

  test('без фильтров печатается весь контент, счётчик не показывается', async ({ page }) => {
    await page.emulateMedia({ media: 'print' })
    const table = page.locator('.print-table')
    await expect(table).toBeVisible()
    await expect(table.locator('tbody tr')).toHaveCount(CONTENT_ROWS)
    await expect(page.locator('.print-chips')).toHaveCount(0)
    await expect(page.locator('.print-head')).not.toContainText('Показано')
    // даты ISO печатаются форматом локали (колонка D фикстуры; строка 0 — шапка листа)
    await expect(table.locator('tbody tr').nth(1).locator('td').nth(3)).toHaveText(
      /^\d{2}\.\d{2}\.\d{4}/,
    )
  })

  test.afterEach(async ({ page }) => {
    // возврат экранной среды — печатный DOM снимается
    await page.emulateMedia({ media: null })
    await expect(page.locator('.print-table')).toHaveCount(0)
    await expect(page.locator('.toolbar')).toBeVisible()
  })
})

test.describe('скоуп «весь лист»: фильтры игнорируются', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('диалог с фильтрами: «Весь лист» печатает 501 строку без чипов', async ({ page }) => {
    await applySpecFilters(page)
    await stubPrint(page)

    await page.keyboard.press('Control+p')
    const dlg = page.getByRole('dialog', { name: 'Печать' })
    // счётчики в подписях диалога отражают фильтры
    await expect(dlg.getByLabel(`Видимые строки (${IVANOV_10000} из ${CONTENT_ROWS})`)).toBeChecked()
    await dlg.getByLabel(`Весь лист (${CONTENT_ROWS})`).check()
    await dlg.getByRole('button', { name: 'Печать…' }).click()
    expect(await printCalls(page)).toBe(1)

    await page.emulateMedia({ media: 'print' })
    const table = page.locator('.print-table')
    await expect(table).toBeVisible()
    await expect(table.locator('tbody tr')).toHaveCount(CONTENT_ROWS)
    await expect(page.locator('.print-chips')).toHaveCount(0)
    await expect(page.locator('.print-head')).not.toContainText('Показано')
  })
})

test('меню «⋯» на мобильном: пункт «Печать» открывает диалог @mobile', async ({ page }) => {
  await openDemoBook(page)
  await stubPrint(page)
  await page.getByRole('button', { name: 'Ещё' }).click()
  await page.getByRole('menuitem', { name: 'Печать' }).click()
  await expect(page.getByRole('dialog', { name: 'Печать' })).toBeVisible()
})
