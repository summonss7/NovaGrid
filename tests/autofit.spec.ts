import { expect, test, type Page } from '@playwright/test'

/*
 * Автоширина колонок по тексту (novagrid-067): «Вид → Колонки по тексту» —
 * ширина колонки по самому широкому тексту в ней: пол 32px, потолок ~220
 * символов (две колонки-переростка равны), ручные ширины и границы не
 * действуют; выключение возвращает ручные ширины, режим персистится.
 */

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    colWidth: (col: number) => page.evaluate(({ col }) => window.__nv!.colWidth(col), { col }),
    setColWidth: (col: number, width: number) =>
      page.evaluate(({ col, width }) => window.__nv!.setColWidth(col, width), { col, width }),
    scrollTo: (x: number, y: number) =>
      page.evaluate(({ x, y }) => window.__nv!.scrollTo(x, y), { x, y }),
  }
}

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  // __nv появляется вместе с гридом после открытия книги
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Иванов')
}

/** Печать в ячейку с фиксацией Enter; далёкие строки — сначала прокрутка.
 *  Латинская клавиша надёжно открывает редактор (у кириллицы keydown нет —
 *  Playwright шлёт insertText в сфокусированный элемент, до редактора он
 *  теряется), дальше весь текст вставляется в сфокусированный input. */
async function typeIntoCell(page: Page, row: number, col: number, text: string) {
  const api = nv(page)
  await api.scrollTo(Math.max(0, col - 2) * 96, row * 30)
  const c = await api.cellCenter(row, col)
  await page.mouse.click(c.x, c.y)
  await page.keyboard.type('x')
  await page.waitForFunction(() =>
    document.activeElement ? document.activeElement.classList.contains('grid-editor') : false,
  )
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.keyboard.press('Enter')
}

async function setAutoFit(page: Page, on: boolean) {
  await page.click('.toolbar-view')
  await expect(page.locator('.view-menu')).toBeVisible()
  const item = page.locator('.view-menu [role="menuitemcheckbox"]', { hasText: 'Колонки по тексту' })
  await expect(item).toHaveAttribute('aria-checked', String(!on))
  await item.click()
  await expect(item).toHaveAttribute('aria-checked', String(on))
  await page.keyboard.press('Escape')
}

test.describe('novagrid-067: автоширина колонок по тексту', () => {
  test('колонки встают по тексту: пол, максимум, потолок; выключение возвращает ручные', async ({
    page,
  }) => {
    await openDemoBook(page)
    const api = nv(page)
    // свободные клетки правее демо-данных: короткая, широкая и переростки
    await typeIntoCell(page, 8, 5, 'ab')
    await typeIntoCell(page, 9, 6, 'Самая длинная строка колонки')
    await typeIntoCell(page, 8, 7, 'ы'.repeat(230))
    await typeIntoCell(page, 9, 8, 'ы'.repeat(400))
    // ручная ширина до включения — должна вернуться после выключения
    await api.setColWidth(9, 300)
    expect(await api.colWidth(6)).toBe(96)

    await setAutoFit(page, true)

    // пол: колонка только с текстом из 2 символов — минимальная ширина
    expect(await api.colWidth(5)).toBe(32)
    // максимум: колонка по широкому тексту — заметно шире стандартной
    const wide = await api.colWidth(6)
    expect(wide).toBeGreaterThan(120)
    expect(wide).toBeLessThan(290)
    // потолок: 230 и 400 символов дают одинаковую ширину — обе у потолка
    const cap1 = await api.colWidth(7)
    expect(cap1).toBe(await api.colWidth(8))
    expect(cap1).toBeGreaterThan(wide)
    expect(cap1).toBeLessThan(2000)
    // ручная ширина в режиме не действует: колонка 9 пустая — стандартная
    expect(await api.colWidth(9)).toBe(96)

    // живой пересчёт: более длинный текст в той же колонке растит ширину
    await typeIntoCell(page, 10, 6, 'ы'.repeat(60))
    expect(await api.colWidth(6)).toBeGreaterThan(wide)

    // выключение: стандартная ширина и ручные переопределения на месте
    await setAutoFit(page, false)
    expect(await api.colWidth(5)).toBe(96)
    expect(await api.colWidth(6)).toBe(96)
    expect(await api.colWidth(9)).toBe(300)
  })

  test('режим персистится после перезагрузки страницы', async ({ page }) => {
    await openDemoBook(page)
    const api = nv(page)
    await setAutoFit(page, true)
    await typeIntoCell(page, 8, 6, 'ab')
    expect(await api.colWidth(6)).toBe(32)

    // настройки «Вида» живут в localStorage — перезагрузка их не роняет
    await page.reload()
    await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
      .toBe('Иванов')
    await typeIntoCell(page, 8, 6, 'ab')
    expect(await api.colWidth(6)).toBe(32)
  })
})
