import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/*
 * Этап 7.6 (novagrid-019, схема А — утверждена владельцем): капсула .nvgridx,
 * круг «сохранил снапшот → изменил книгу → открыл снапшот → книга как была».
 * Экспорт идёт fallback-путём (FSA отключён init-скриптом — скачивание), как
 * в files.spec.ts; импорт — общий input теми же байтами. Провайдеру видно
 * только шифротекст — проверяем, что внутри буфера нет открытого текста книги.
 */

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    book: () => page.evaluate(() => window.__nv!.book()),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
  }
}

async function editCell(page: Page, row: number, col: number, text: string) {
  const center = await nv(page).cellCenter(row, col)
  await page.mouse.click(center.x, center.y)
  await page.keyboard.press(text[0])
  if (text.length > 1) await page.keyboard.type(text.slice(1))
  await page.keyboard.press('Enter')
}

test.beforeEach(async ({ page }) => {
  // fallback-среда: пикеры FSA отсутствуют, экспорт — скачиванием
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { get: () => undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { get: () => undefined })
  })
})

test.describe('снапшот .nvgridx: экспорт → импорт', () => {
  test('круг: правка уехала в капсулу, книга восстановилась с исходным именем', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    // правка C2 → 999: её и заберём капсулой
    await editCell(page, 1, 2, '999')
    await expect.poll(() => nv(page).cell(1, 2)).toBe('999')

    // «Сохранить как…» → формат .nvgridx → фраза дважды → скачивание
    await page.getByRole('button', { name: 'Сохранить как…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await dialog.getByLabel('Формат').selectOption('nvgridx')
    await dialog.getByLabel('Парольная фраза').fill('фраза-тест-42')
    await dialog.getByLabel('Повторите фразу').fill('фраза-тест-42')
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('demo-book.nvgridx')
    const savedPath = test.info().outputPath('demo-book.nvgridx')
    await download.saveAs(savedPath)

    // тост успеха; книга не «сохранена» — снапшот побочный файл, ● на месте
    await expect(page.locator('.toast-ok')).toContainText('Снапшот сохранён: demo-book.nvgridx')
    expect((await nv(page).book()).dirty).toBe(true)

    // капсула непрозрачна: магия на месте, открытого текста книги внутри нет
    const bytes = readFileSync(savedPath)
    expect([...bytes.slice(0, 8)]).toEqual([0x4e, 0x56, 0x47, 0x52, 0x49, 0x44, 0x58, 0x01])
    expect(bytes.toString('latin1')).not.toContain('Иванов')

    // после снапшота книгу меняем дальше — импорт должен вернуть 999
    await editCell(page, 1, 2, '777')
    await expect.poll(() => nv(page).cell(1, 2)).toBe('777')

    // открытие капсулы общим конвейером → диалог фразы
    await page.setInputFiles('#nv-file-input', savedPath)
    const snapDialog = page.getByRole('dialog', { name: 'Снапшот NovaGrid' })
    await expect(snapDialog).toBeVisible()
    await expect(snapDialog.locator('.dialog-value')).toContainText('demo-book.nvgridx')

    // неверная фраза — инлайн-ошибка, диалог жив (можно повторить)
    await snapDialog.getByLabel('Парольная фраза').fill('совсем не та')
    await snapDialog.getByRole('button', { name: 'Открыть', exact: true }).click()
    await expect(snapDialog.locator('.dialog-error')).toContainText('Неверная парольная фраза')

    // верная фраза — книга восстановлена: правка капсулы, оба листа, имя и чистый dirty
    await snapDialog.getByLabel('Парольная фраза').fill('фраза-тест-42')
    await snapDialog.getByRole('button', { name: 'Открыть', exact: true }).click()
    await expect(snapDialog).not.toBeVisible()
    await expect.poll(() => nv(page).cell(1, 2)).toBe('999')
    const book = await nv(page).book()
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник'])
    expect(book.fileName).toBe('demo-book.xlsx')
    expect(book.dirty).toBe(false)
  })

  test('несовпавшие фразы не выпускают из диалога сохранения', async ({ page }) => {
    await page.goto('/?testui=1')
    await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    await page.getByRole('button', { name: 'Сохранить как…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await dialog.getByLabel('Формат').selectOption('nvgridx')
    // короткая фраза — своя ошибка, кнопка «Сохранить» не действует
    await dialog.getByLabel('Парольная фраза').fill('abc')
    await dialog.getByLabel('Повторите фразу').fill('abc')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog.locator('.dialog-error')).toContainText('не короче 4')

    // несовпадение повтора — вторая ошибка, диалог открыт
    await dialog.getByLabel('Парольная фраза').fill('фраза-тест-42')
    await dialog.getByLabel('Повторите фразу').fill('другая фраза')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(dialog.locator('.dialog-error')).toContainText('не совпадают')
    await expect(dialog).toBeVisible()
  })

  test('отмена диалога фразы: книга не менялась, капсулу можно открыть позже', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/?testui=1')
    await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    // сворачиваем капсулу
    await page.getByRole('button', { name: 'Сохранить как…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await dialog.getByLabel('Формат').selectOption('nvgridx')
    await dialog.getByLabel('Парольная фраза').fill('фраза-тест-42')
    await dialog.getByLabel('Повторите фразу').fill('фраза-тест-42')
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    const savedPath = test.info().outputPath('cancel.nvgridx')
    await download.saveAs(savedPath)

    // правка после снапшота остаётся при отмене импорта (Esc)
    await editCell(page, 1, 2, '555')
    await expect.poll(() => nv(page).cell(1, 2)).toBe('555')
    await page.setInputFiles('#nv-file-input', savedPath)
    const snapDialog = page.getByRole('dialog', { name: 'Снапшот NovaGrid' })
    await expect(snapDialog).toBeVisible()
    await snapDialog.press('Escape')
    await expect(snapDialog).not.toBeVisible()
    await expect.poll(() => nv(page).cell(1, 2)).toBe('555')
    expect((await nv(page).book()).fileName).toBe('demo-book.xlsx')
  })
})
