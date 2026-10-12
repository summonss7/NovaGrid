import { expect, test } from '@playwright/test'

/*
 * Стартовый экран (Этап 2.4) и каркас главного окна: фирменные цвета,
 * self-host шрифты, SVG-логотип. Сценарии ядра таблицы — grid.spec.ts,
 * файловый цикл Этапа 2 — files.spec.ts.
 * Обычная загрузка «/» открывает стартовый экран «Недавние»; «/?test=1» —
 * сразу книгу с демо-листом (детерминированный режим e2e Этапа 1).
 */

test.describe('стартовый экран — Этап 2.4', () => {
  test('«/» открывает стартовый экран: Открыть, Новая, Недавние, демо-карточки', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.getByRole('button', { name: 'Открыть файл…' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Новая таблица' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Недавние' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Демо-книга сценария ТЗ/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Книга ODS/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Стресс 100 000 строк/ })).toBeVisible()
    await expect(page.locator('.start-privacy')).toContainText('локально')

    // «Новая таблица» ведёт в книгу: пустой «Лист 1» и панели каркаса
    await page.getByRole('button', { name: 'Новая таблица' }).click()
    await expect(page.getByRole('grid', { name: 'Таблица' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Лист 1' })).toBeVisible()
    // без ?test=1 тест-хука в приложении нет
    expect(await page.evaluate(() => window.__nv === undefined)).toBe(true)
  })
})

test.describe('главный экран — каркас книги', () => {
  test('панели каркаса собираются (тулбар, строка формул, грид, листы, статус-бар)', async ({
    page,
  }) => {
    await page.goto('/?test=1')

    await expect(page).toHaveTitle(/NovaGrid/)
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить как…' })).toBeVisible()
    await expect(page.getByPlaceholder('Поиск…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Справка (?)' })).toBeVisible()
    // Σ — автосумма (novagrid-020), рядом шеврон метрик выделения
    await expect(page.getByRole('button', { name: 'Автосумма' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сумма выделенного' })).toBeVisible()
    await expect(page.getByLabel('Строка формул')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Лист 1' })).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Таблица' })).toBeVisible()
    await expect(page.locator('canvas.grid-canvas')).toBeVisible()
  })

  test('SVG-логотип «N» и словесная часть отрисованы', async ({ page }) => {
    await page.goto('/?test=1')

    const mark = page.locator('.logo-mark')
    await expect(mark).toBeVisible()
    // знак — это svg с фигурами стрелок (2 линии-стрелки + 2 полигона-наконечника)
    await expect(mark.locator('polygon')).toHaveCount(2)
    await expect(page.locator('.logo-word')).toContainText('NovaGrid')
  })

  test('фирменные цвета применены через дизайн-токены', async ({ page }) => {
    await page.goto('/?test=1')

    // панели (тулбар, листы, статус-бар) — surface #EDEDEB
    await expect(page.locator('.toolbar')).toHaveCSS('background-color', 'rgb(237, 237, 235)')
    await expect(page.locator('.status-bar')).toHaveCSS('background-color', 'rgb(237, 237, 235)')
    // главная кнопка Σ (автосумма) — оранжевый акцент #F26B21
    await expect(page.getByRole('button', { name: 'Автосумма' })).toHaveCSS(
      'background-color',
      'rgb(242, 107, 33)',
    )
    // кнопки действий — зелёный кнопок AA (Этап 6.2: белый текст ≥ 4.5:1) #1E7D36
    await expect(page.getByRole('button', { name: 'Открыть' })).toHaveCSS(
      'background-color',
      'rgb(30, 125, 54)',
    )
  })

  test('шрифты Montserrat и Open Sans self-hosted — без внешних CDN', async ({ page }) => {
    const fontUrls: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('.woff2')) {
        fontUrls.push(response.url())
      }
    })

    await page.goto('/?test=1')
    await page.waitForLoadState('networkidle')

    // оба семейства действительно запрошены и отданы локально
    expect(fontUrls.length).toBeGreaterThanOrEqual(2)
    expect(fontUrls.every((url) => url.startsWith('http://localhost:5173/'))).toBe(true)
    await expect(page.locator('.logo-word')).toHaveCSS('font-family', /Montserrat/)
    await expect(page.locator('body')).toHaveCSS('font-family', /Open Sans/)
  })
})
