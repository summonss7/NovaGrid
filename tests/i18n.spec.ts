import { expect, test } from '@playwright/test'

/*
 * Этап 6.3 «Локализация en и настройки»: язык интерфейса переключается
 * без перезагрузки (словарь + формат чисел), размер таблицы применяется
 * через зум, разделитель CSV из настроек предвыбран в «Сохранить как…»,
 * всё живёт в localStorage и переживает перезагрузку.
 */

test.describe('локализация и настройки (6.3)', () => {
  test('переключение ru → en меняет интерфейс и формат чисел, персистится', async ({ page }) => {
    await page.goto('/?testui=1')
    // стартовый экран по-русски
    await expect(page.getByRole('button', { name: 'Открыть файл…' })).toBeVisible()

    // открыть демо-книгу и встать на числовую ячейку — Σ статус-бара живой
    await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
      .toBe('Иванов')
    const c2 = await page.evaluate(() => window.__nv!.cellCenter(1, 2))
    await page.mouse.click(c2.x, c2.y)
    // статус-бар слева показывает честную версию программы (novagrid-043):
    // тот же источник, что у заголовка окна (package.json); novagrid-055
    // добавил дату сборки — «NovaGrid v1.27.0 от 05.11.2026»
    await expect(page.locator('.status-phase')).toHaveText(
      /^NovaGrid v\d+\.\d+\.\d+ от \d{2}\.\d{2}\.\d{4}$/,
    )

    // настройки: шестерёнка в тулбаре → English
    await page.click('.toolbar-settings')
    await expect(page.locator('.settings-dialog')).toBeVisible()
    await page.click('.settings-dialog .settings-seg >> text=English')
    await expect(page.getByRole('button', { name: 'Open' })).toBeVisible()
    // document.lang для скринридеров
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.keyboard.press('Escape')

    // формат чисел статус-бара — en-US: активная ячейка 10000 → «10,000»
    await expect(page.locator('.status-metric').first()).toContainText('Σ 10,000')

    // персист: перезагрузка сохраняет язык (стартовый экран тоже локализован)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Open file…' })).toBeVisible()
  })

  test('размер таблицы «Крупный» применяется и переживает перезагрузку', async ({ page }) => {
    await page.goto('/?testui=1&test=1')
    await page.waitForFunction(() => window.__nv !== undefined)
    const before = await page.evaluate(() => window.__nv!.cellMetrics().rowH)

    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=Крупный')
    const zoomed = await page.evaluate(() => window.__nv!.zoom())
    expect(zoomed).toBeGreaterThan(1)
    const after = await page.evaluate(() => window.__nv!.cellMetrics().rowH)
    expect(after).toBeGreaterThan(before)
    await page.keyboard.press('Escape')

    // персист: после перезагрузки зум восстановлен из настроек
    await page.reload()
    await page.waitForFunction(() => window.__nv !== undefined)
    expect(await page.evaluate(() => window.__nv!.zoom())).toBeGreaterThan(1)

    // вернуть «Обычный»
    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=Обычный')
    await page.keyboard.press('Escape')
  })

  test('новые языки novagrid-070: ro/sk/ar переключаются, арабский даёт RTL', async ({ page }) => {
    await page.goto('/?testui=1&test=1')
    await page.waitForFunction(() => window.__nv !== undefined)

    // румынский: интерфейс и формат чисел ro-RO (10 000 → «10.000»)
    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=Română')
    await expect(page.getByRole('button', { name: 'Deschide' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ro')
    await page.keyboard.press('Escape')
    // формат чисел: ячейка B2 демо-книги = 10000
    await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
      .toBe('Иванов')
    const ro = await page.evaluate(() => window.__nv!.cellCenter(1, 2))
    await page.mouse.click(ro.x, ro.y)
    await expect(page.locator('.status-metric').first()).toContainText('Σ 10.000')

    // словацкий: заголовок справки sk-SK, формат 10 000 (неразрывный пробел)
    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=Slovenčina')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Otvoriť' })).toBeVisible()
    await expect(page.locator('.status-metric').first()).toContainText(/Σ 10\s000/)

    // арабский: html dir=rtl (интерфейс справа налево), грид остаётся LTR
    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=العربية')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'فتح' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('.grid-area')).toHaveAttribute('dir', 'ltr')

    // назад в русский: dir возвращается в ltr
    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=Русский')
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    // мы в режиме книги — тулбарный «Открыть» снова по-русски
    await expect(page.getByRole('button', { name: 'Открыть' })).toBeVisible()
  })

  test('разделитель CSV из настроек предвыбран в «Сохранить как…»', async ({ page }) => {
    await page.goto('/?testui=1&test=1')
    await page.waitForFunction(() => window.__nv !== undefined)

    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=, запятая')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Shift+S')
    const dialog = page.locator('.dialog')
    await expect(dialog).toBeVisible()
    // формат CSV — появляется select разделителя, предвыбрана запятая из настроек
    await dialog.locator('select').first().selectOption('csv')
    await expect(dialog.locator('select').nth(1)).toHaveValue(',')
    await page.keyboard.press('Escape')

    // вернуть точку с запятой
    await page.click('.toolbar-settings')
    await page.click('.settings-dialog .settings-seg >> text=; точка с запятой')
    await page.keyboard.press('Escape')
  })
})
