import { expect, test } from '@playwright/test'

// Каркас �тапа 0 + живой грид �тапа 1: экран открывается в фирменных цветах,
// со self-host шрифтами и SVG-логотипом; сцена�рии ядра таблицы — grid.spec.ts.
test.describe('стартовый экран — каркас �тапа 0', () => {
  test('главный экран собирается из всех панелей каркаса', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/NovaGrid/)
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible()
    await expect(page.getByPlaceholder('Поиск…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Справка' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сумма выделенного' })).toBeVisible()
    await expect(page.getByLabel('Строка формул')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Лист 1' })).toBeVisible()
    // вместо заглушки �тапа 0 — настоящий канвас-грид (role=grid)
    await expect(page.getByRole('grid', { name: 'Таблица' })).toBeVisible()
    await expect(page.locator('canvas.grid-canvas')).toBeVisible()
  })

  test('SVG-логотип «N» и словесная часть отрисованы', async ({ page }) => {
    await page.goto('/')

    const mark = page.locator('.logo-mark')
    await expect(mark).toBeVisible()
    // знак — это svg с фигурами стрелок (2 линии-стрелки + 2 полигона-наконечника)
    await expect(mark.locator('polygon')).toHaveCount(2)
    await expect(page.locator('.logo-word')).toContainText('NovaGrid')
  })

  test('фирменные цвета применены через дизайн-токены', async ({ page }) => {
    await page.goto('/')

    // панели (тулбар, листы, статус-бар) — surface #EDEDEB
    await expect(page.locator('.toolbar')).toHaveCSS('background-color', 'rgb(237, 237, 235)')
    await expect(page.locator('.status-bar')).toHaveCSS('background-color', 'rgb(237, 237, 235)')
    // главная кнопка Σ — оранжевый акцент #F26B21
    await expect(page.getByRole('button', { name: 'Сумма выделенного' })).toHaveCSS(
      'background-color',
      'rgb(242, 107, 33)',
    )
    // кнопки действий — глубокий зелёный #2BA84A
    await expect(page.getByRole('button', { name: 'Открыть' })).toHaveCSS(
      'background-color',
      'rgb(43, 168, 74)',
    )
  })

  test('шрифты Montserrat и Open Sans self-hosted — без внешних CDN', async ({ page }) => {
    const fontUrls: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('.woff2')) {
        fontUrls.push(response.url())
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // оба семейства действительно запрошены и отданы локально
    expect(fontUrls.length).toBeGreaterThanOrEqual(2)
    expect(fontUrls.every((url) => url.startsWith('http://localhost:5173/'))).toBe(true)
    await expect(page.locator('.logo-word')).toHaveCSS('font-family', /Montserrat/)
    await expect(page.locator('body')).toHaveCSS('font-family', /Open Sans/)
  })
})
