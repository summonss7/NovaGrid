import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 6.2 «Доступность»: клавиатурный путь к фильтрам ТЗ без мыши —
 * Shift+F10 открывает меню активной ячейки (паттерн WAI-ARIA menu: фокус
 * в первом пункте, ↑↓ циклично, Esc закрывает, фокус возвращается гриду),
 * живой регион объявляет активную ячейку скринридеру (канвас-грид без
 * DOM-ячеек), роли/подписи панелей на месте.
 */

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Иванов')
}

const gridArea = '.grid-area'

test.describe('клавиатура везде (6.2)', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
    await page.focus(gridArea)
  })

  test('Shift+F10 открывает меню ячейки, Enter фильтрует, фокус возвращается гриду', async ({
    page,
  }) => {
    // активная ячейка A2 «Иванов» — как в сценарии ТЗ, но без мыши
    await page.keyboard.press('ArrowDown')
    const menu = page.locator('.ctx-menu')
    await page.keyboard.press('Shift+F10')
    await expect(menu).toBeVisible()
    // паттерн menu: фокус в первом пункте — основные действия (novagrid-032)
    await expect(menu.locator('button').first()).toBeFocused()
    await expect(menu.locator('button').first()).toContainText('Вырезать')

    // стрелками доходим до фильтра и применяем Enter'ом; недоступные пункты
    // (объединение ячеек на одиночной ячейке, novagrid-047) навигация пропускает
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
    const filterItem = menu.getByRole('menuitem', { name: 'Фильтровать: A = «Иванов»' })
    await expect(filterItem).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect
      .poll(() => page.evaluate(() => window.__nv!.visibleRows()?.length ?? -1))
      .toBe(180) // 180 строк «Иванов» (без второго фильтра по C)
    // фокус вернулся гриду — продолжаем работать с клавиатуры
    await expect(page.locator(gridArea)).toBeFocused()
  })

  test('↑↓ ходят по пунктам циклично, Esc закрывает без действия', async ({ page }) => {
    await page.keyboard.press('Shift+F10')
    const items = page.locator('.ctx-menu button')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp') // со второго — назад к первому
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowUp') // цикл: с первого — на последний
    const last = items.nth((await items.count()) - 1)
    await expect(last).toBeFocused()
    await page.keyboard.press('ArrowDown') // цикл: с последнего — на первый
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.ctx-menu')).toBeHidden()
    expect(await page.evaluate(() => window.__nv!.filters())).toHaveLength(0)
    await expect(page.locator(gridArea)).toBeFocused()
  })

  test('живой регион объявляет активную ячейку (канвас-грид)', async ({ page }) => {
    const live = page.locator('.status-bar .sr-only[aria-live="polite"]')
    await expect(live).toHaveText(/^A1/)
    await page.keyboard.press('ArrowDown')
    await expect(live).toContainText('A2')
    await expect(live).toContainText('Иванов')
  })

  test('меню колонки: фокус в поиске значений, Esc возвращает фокус гриду', async ({ page }) => {
    // ПКМ по шапке колонки A открывает меню колонки (Ф3.7)
    const center = await page.evaluate(() => window.__nv!.cellCenter(-1, 0))
    await page.mouse.click(center.x, center.y, { button: 'right' })
    const colMenu = page.locator('.col-menu')
    await expect(colMenu).toBeVisible()
    await expect(colMenu.locator('input[type="search"]')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(colMenu).toBeHidden()
    await expect(page.locator(gridArea)).toBeFocused()
  })
})
