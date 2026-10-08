import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/*
 * Этап 2 «Файлы» (КТ): e2e «открыл → изменил → сохранил → переоткрыл»,
 * демо-файл открывается ≤ 3 с, вкладки листов, сохранение CSV, стресс 100k
 * и восстановление сессии из «Недавних». File System Access в прогоне
 * отключён init-скриптом — сохранение идёт fallback-путем (диалог + скачивание),
 * так же, как в Firefox/Safari (CONCEPT Ф1).
 *
 * Тип window.__nv объявлен в grid.spec.ts (общий для проекта тестов).
 */

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    book: () => page.evaluate(() => window.__nv!.book()),
    scrollTo: (x: number, y: number) =>
      page.evaluate(({ x, y }) => window.__nv!.scrollTo(x, y), { x, y }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
  }
}

test.beforeEach(async ({ page }) => {
  // fallback-среда: пикеры FSA отсутствуют, как в Firefox/Safari/IE-подобных
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { get: () => undefined })
    Object.defineProperty(window, 'showOpenFilePicker', { get: () => undefined })
  })
})

async function openFixtureFile(page: Page, path: string) {
  await page.setInputFiles('#nv-file-input', path)
}

test.describe('файловой цикл: открыл → изменил → сохранил → переоткрыл', () => {
  test('демо-книга ТЗ открывается ≤ 3 с, правка сохраняется и переживает переоткрытие', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await expect(page.getByRole('button', { name: 'Открыть файл…' })).toBeVisible()

    // КТ «демо-файл открывается ≤ 3 с»: бюджет = таймаут poll ниже
    const started = Date.now()
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThanOrEqual(3000)

    // книга загрузилась: два листа фикстуры, имя файла чистое
    const api = nv(page)
    let book = await api.book()
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник'])
    expect(book.fileName).toBe('demo-book.xlsx')
    expect(book.dirty).toBe(false)

    // правка C2 → 12345: появляется ● несохранённых изменений
    const center = await api.cellCenter(1, 2)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('1')
    await page.keyboard.type('2345')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(1, 2)).toBe('12345')
    book = await api.book()
    expect(book.dirty).toBe(true)
    await expect(page.locator('.file-dirty')).toBeVisible()

    // Ctrl+S без FSA → диалог «Сохранить как…» → скачивание файла
    const downloadPromise = page.waitForEvent('download')
    await page.keyboard.press('Control+s')
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    const savedPath = test.info().outputPath('demo-saved.xlsx')
    await download.saveAs(savedPath)

    // тост подтверждения и снятый dirty
    await expect(page.locator('.toast-ok')).toContainText('demo-book.xlsx')
    await expect.poll(() => api.book().then((b) => b.dirty)).toBe(false)

    // переоткрыли сохранённый файл — правка на месте
    await openFixtureFile(page, savedPath)
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 2) ?? ''), { timeout: 3000 })
      .toBe('12345')
    book = await api.book()
    expect(book.fileName).toBe('demo-book.xlsx')
    expect(book.dirty).toBe(false)
  })

  test('«Сохранить как CSV»: разделитель «;», правки в файле', async ({ page }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    const api = nv(page)
    const center = await api.cellCenter(1, 2)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('7')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(1, 2)).toBe('7')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Сохранить как…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await dialog.getByLabel('Формат').selectOption('csv')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    const csvPath = test.info().outputPath('demo-saved.csv')
    await download.saveAs(csvPath)

    // BOM + CRLF + правка третьей колонки (C2=7)
    const text = readFileSync(csvPath, 'utf8')
    expect(text.startsWith('\uFEFF')).toBe(true)
    expect(text).toContain('Фамилия;Отдел;Сумма;Дата')
    expect(text).toContain('Иванов;')
    expect(text).toMatch(/;7;/)
    expect(download.suggestedFilename()).toBe('demo-book.csv')
  })

  test('старый .xls (SheetJS) читается', async ({ page }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/legacy-demo.xls')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')
    const book = await nv(page).book()
    expect(book.tabs).toEqual(['Лист1'])
    expect(book.fileName).toBe('legacy-demo.xls')
  })
})

test.describe('вкладки листов (2.2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')
  })

  test('переключение листов, добавить/переименовать/дублировать/удалить', async ({ page }) => {
    const api = nv(page)

    // переключение: «Справочник» — второй лист фикстуры
    await page.getByRole('tab', { name: 'Справочник' }).click()
    await expect.poll(() => api.cell(0, 0)).toBe('Отдел')

    // добавить: уникальное имя, сразу активна
    await page.getByRole('button', { name: 'Добавить лист' }).click()
    let book = await api.book()
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник', 'Лист 3'])
    expect(book.activeTab).toBe(2)

    // переименовать двойным кликом
    await page.getByRole('tab', { name: 'Лист 3' }).dblclick()
    const renameInput = page.getByLabel('Переименовать')
    await renameInput.fill('Черновик')
    await renameInput.press('Enter')
    book = await api.book()
    expect(book.tabs[2]).toBe('Черновик')

    // дублировать через меню ПКМ
    await page.getByRole('tab', { name: 'Черновик' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Дублировать' }).click()
    book = await api.book()
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник', 'Черновик', 'Черновик (2)'])
    expect(book.activeTab).toBe(3)

    // удалить пустой дубль — без подтверждения
    await page.getByRole('tab', { name: 'Черновик (2)' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    book = await api.book()
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник', 'Черновик'])

    // удалить непустой «Сотрудники» — подтверждение принимается сразу:
    // клик не завершится, пока нативный диалог открыт (обработчик независим)
    const confirmMessage = page.waitForEvent('dialog').then(async (d) => {
      const msg = d.message()
      await d.accept()
      return msg
    })
    await page.getByRole('tab', { name: 'Сотрудники' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Удалить' }).click()
    expect(await confirmMessage).toContain('Сотрудники')
    book = await api.book()
    expect(book.tabs).toEqual(['Справочник', 'Черновик'])
    // удаляли вкладку левее активной — активной остаётся «Черновик» (индекс 1)
    expect(book.activeTab).toBe(1)
  })
})

test.describe('стресс 100k строк (2.5)', () => {
  test('CSV 100 001 строка открывается, лист читается на глубине', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/stress-100k.csv')

    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(0, 0) ?? ''), { timeout: 60_000 })
      .toBe('№')

    const api = nv(page)
    const book = await api.book()
    expect(book.rows).toBe(100_001)
    expect(book.tabs).toEqual(['stress-100k'])

    // эталон последней строки берём из самого файла фикстуры (детерминированной)
    const lastLine = readFileSync('public/fixtures/stress-100k.csv', 'utf8')
      .trimEnd()
      .split(/\r?\n/)
      .pop()!
    const lastFields = lastLine.split(';')

    // вглубь листа: последняя строка читается из модели
    await api.scrollTo(0, 30 * 100_001 - 600)
    await expect.poll(() => api.cell(100_000, 0)).toBe(lastFields[0])
    await expect.poll(() => api.cell(100_000, 6)).toBe(lastFields[6])
  })
})

test.describe('автосохранение сессии и «Недавние» (2.4)', () => {
  test('правка восстанавливается после перезагрузки из Недавних', async ({ page }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    const api = nv(page)
    const center = await api.cellCenter(1, 1)
    await page.mouse.click(center.x, center.y)
    // кириллицу вводим в уже открытый редактор: латинская клавиша открывает
    // правку с заменой, дальше — выделить всё и набрать текст
    await page.keyboard.press('9')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Заметка сессии')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(1, 1)).toBe('Заметка сессии')

    // ждём дебаунс автосохранения (1 с) и сброс в IndexedDB
    await page.waitForTimeout(2200)

    // краш: полная перезагрузка — стартовый экран предлагает «Недавние»
    await page.reload()
    const recent = page.locator('.start-recent-item').filter({ hasText: 'demo-book.xlsx' }).first()
    await expect(recent).toBeVisible({ timeout: 10_000 })
    await recent.getByRole('button', { name: 'demo-book.xlsx' }).click()

    // книга восстановлена вместе с правкой; правки не в файле — ● честно горит
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 1) ?? ''), { timeout: 3000 })
      .toBe('Заметка сессии')
    const book = await nv(page).book()
    expect(book.dirty).toBe(true)
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник'])
  })
})
