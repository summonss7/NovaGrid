import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 6.4 «Матрица платформ»: смок-набор для браузеров (chromium/firefox/
 * webkit — тег @smoke в конфиге) и мобильная эмуляция Android (Pixel 7,
 * тег @mobile). Сценарий пользователя из ТЗ должен проходиться < 1 минуты
 * (КТ-5) на Windows и Android — замеряем по фактам.
 */

const IVANOV_AND_10K = 132

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 10_000 })
    .toBe('Иванов')
}

async function cellCenter(page: Page, row: number, col: number) {
  return page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col })
}

test.describe('@smoke матрица браузеров (6.4)', () => {
  test('сценарий ТЗ: открыл → ПКМ-фильтры → 132 строки → Σ за < 1 минуты', async ({ page }) => {
    const t0 = Date.now()
    await openDemoBook(page)

    // ПКМ на «Иванов» в A → фильтр по значению (главный жест ТЗ)
    let c = await cellCenter(page, 1, 0)
    await page.mouse.click(c.x, c.y, { button: 'right' })
    await page.locator('.ctx-menu .ctx-item-primary').click()

    // ПКМ на «10000» в C → второй фильтр
    c = await cellCenter(page, 1, 2)
    await page.mouse.click(c.x, c.y, { button: 'right' })
    await page.locator('.ctx-menu .ctx-item-primary').click()

    await expect
      .poll(() => page.evaluate(() => window.__nv!.visibleRows()?.length ?? -1))
      .toBe(IVANOV_AND_10K)

    // Σ видимой колонки C
    c = await cellCenter(page, -1, 2)
    await page.mouse.click(c.x, c.y)
    await expect(page.locator('.status-metric').first()).toContainText('1 320 000')

    expect(Date.now() - t0).toBeLessThan(60_000) // КТ-5: сценарий < 1 минуты
  })

  test('формула SUMIFS по отфильтрованному считается', async ({ page }) => {
    await openDemoBook(page)
    const c = await cellCenter(page, 0, 4)
    await page.mouse.click(c.x, c.y)
    await page.keyboard.type('=SUMIFS(C2:C501;A2:A501;"Иванов";C2:C501;10000)')
    await page.keyboard.press('Enter')
    await expect
      .poll(() => page.evaluate(() => window.__nv!.cellText(0, 4)), { timeout: 5_000 })
      .toBe('1320000')
  })
})

test.describe('@mobile Android-эмуляция Pixel 7 (6.4)', () => {
  test('сценарий фильтрации касаниями без мыши, Σ через нижнюю панель, < 1 минуты', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const t0 = Date.now()
    await openDemoBook(page)

    // длинное нажатие = ПКМ (5.2): синтетический touch-pointerdown, таймер
    // меню срабатывает через 500 мс без отпускания
    const ivanov = await cellCenter(page, 1, 0)
    await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y)!
        el.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerType: 'touch',
            button: 0,
            clientX: x,
            clientY: y,
            bubbles: true,
          }),
        )
      },
      { x: ivanov.x, y: ivanov.y },
    )
    const menu = page.locator('.ctx-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })
    await menu.locator('.ctx-item-primary').click()

    await expect
      .poll(() => page.evaluate(() => window.__nv!.visibleRows()?.length ?? -1))
      .toBe(180) // один фильтр: все «Иванов»

    // нижняя панель: Σ открывает карточку метрик (5.2); числовая точность
    // Σ проверена десктоп-сценарием КТ-3 — здесь важен сам тач-путь
    await page.locator('.mobile-bar-sum').tap()
    const card = page.locator('.sum-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Сумма')

    expect(Date.now() - t0).toBeLessThan(60_000) // КТ-5: Android < 1 минуты
  })
})
