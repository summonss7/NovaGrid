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
 * window.__tauriMock — мок десктоп-моста для тестов novagrid-033 (ниже).
 */

declare global {
  interface Window {
    __TAURI__?: unknown
    __tauriMock?: {
      /** все invoke-вызовы моста: команды и аргументы */
      calls: { cmd: string; args?: Record<string, unknown> }[]
      /** слушатели событий обёртки (novagrid:menu, novagrid:close-ask) */
      listeners: Record<string, ((e: { payload: unknown }) => void)[]>
    }
  }
}

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellText: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellText(row, col), { row, col }),
    book: () => page.evaluate(() => window.__nv!.book()),
    scrollTo: (x: number, y: number) =>
      page.evaluate(({ x, y }) => window.__nv!.scrollTo(x, y), { x, y }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    /** закрепление активной вкладки (novagrid-050) */
    freeze: () => page.evaluate(() => window.__nv!.freeze()),
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

  test('.ods: листы → вкладки, формулы, даты ISO, правка → сохранить как .xlsx → переоткрыть', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/ods-book.ods')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    // два листа ODS-книги → две вкладки; даты читаются ISO-строками
    const api = nv(page)
    let book = await api.book()
    expect(book.tabs).toEqual(['Данные', 'Справка'])
    expect(book.fileName).toBe('ods-book.ods')
    await expect.poll(() => api.cell(1, 3)).toBe('2026-09-01')

    // формулы .ods читаются и пересчитываются (novagrid-040): «×2» и итог SUM
    await expect.poll(() => api.cellText(1, 4)).toBe('20000')
    await expect.poll(() => api.cellText(5, 2)).toBe('45900')

    // второй лист книги ODS открывается вкладкой; межлистовая ссылка
    // показывает кэш из файла (∛) — =данные!C6
    await page.getByRole('tab', { name: 'Справка' }).click()
    await expect.poll(() => api.cell(0, 0)).toBe('Отдел')
    await expect.poll(() => api.cellText(4, 2)).toBe('45900')
    await page.getByRole('tab', { name: 'Данные' }).click()

    // правка C2 → 4242: формулы листа пересчитались (×2 и итог)
    const center = await api.cellCenter(1, 2)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('4')
    await page.keyboard.type('242')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(1, 2)).toBe('4242')
    await expect.poll(() => api.cellText(1, 4)).toBe('8484')
    await expect.poll(() => api.cellText(5, 2)).toBe('40142')

    // «Сохранить как…»: .ods-книга сохраняется прямо в .ods своим writer
    // (novagrid-050), заметки о конверте больше нет
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Сохранить как…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('select').first()).toHaveValue('ods')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('ods-book.ods')
    const savedPath = test.info().outputPath('ods-saved.ods')
    await download.saveAs(savedPath)

    // переоткрыли сохранённый .ods: правка, второй лист и формулы на месте;
    // ждём именно переключения книги (значения истинны и до него — гонка)
    await openFixtureFile(page, savedPath)
    await expect
      .poll(() => page.evaluate(() => window.__nv?.book().fileName ?? ''), { timeout: 3000 })
      .toBe('ods-saved.ods')
    await expect.poll(() => api.cell(1, 2)).toBe('4242')
    await expect.poll(() => api.cellText(1, 4)).toBe('8484')
    await expect.poll(() => api.cellText(5, 2)).toBe('40142')
    book = await api.book()
    expect(book.tabs).toEqual(['Данные', 'Справка'])
  })

  test('оформление листа едет в .xlsx и возвращается (novagrid-050)', async ({ page }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    const api = nv(page)
    // жирный + перенос на чистой ячейке A2 (Ctrl+B, кнопка «Перенос текста»)
    const a2 = await api.cellCenter(1, 0)
    await page.mouse.click(a2.x, a2.y)
    await page.keyboard.press('Control+b')
    await page.getByRole('button', { name: 'Перенос текста' }).click()
    // ширина колонки B — перетаскиванием из тест-хука; закреп до B2 — ПКМ
    await page.evaluate(() => window.__nv!.setColWidth(1, 150))
    const b2 = await api.cellCenter(1, 1)
    await page.mouse.click(b2.x, b2.y, { button: 'right' })
    await page
      .getByRole('menuitem', { name: 'Закрепить области (выше и левее активной ячейки)' })
      .click()
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })
    expect(JSON.stringify(await page.evaluate(() => window.__nv!.style(1, 0)))).toBe(
      JSON.stringify({ bold: true, wrap: true }),
    )

    // Ctrl+S → диалог (нет FSA) → скачивание
    const downloadPromise = page.waitForEvent('download')
    await page.keyboard.press('Control+s')
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    const savedPath = test.info().outputPath('styled.xlsx')
    await download.saveAs(savedPath)

    // переоткрыли: стиль, ширина и закрепление пережили круг через файл;
    // ждём именно переключения книги (стиль/ширина истинны и до него — гонка)
    await openFixtureFile(page, savedPath)
    await expect
      .poll(() => page.evaluate(() => window.__nv?.book().fileName ?? ''), { timeout: 3000 })
      .toBe('styled.xlsx')
    await expect
      .poll(() => page.evaluate(() => JSON.stringify(window.__nv!.style(1, 0))))
      .toBe(JSON.stringify({ bold: true, wrap: true }))
    expect(await page.evaluate(() => window.__nv!.colWidth(1))).toBe(150)
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })
  })

  test('«Сохранить как .ods»: оформление возвращается своим парсером (novagrid-050)', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    const api = nv(page)
    const a2 = await api.cellCenter(1, 0)
    await page.mouse.click(a2.x, a2.y)
    await page.keyboard.press('Control+b')
    await page.evaluate(() => window.__nv!.setColWidth(1, 150))
    const b2 = await api.cellCenter(1, 1)
    await page.mouse.click(b2.x, b2.y, { button: 'right' })
    await page
      .getByRole('menuitem', { name: 'Закрепить области (выше и левее активной ячейки)' })
      .click()

    // «Сохранить как…» → формат .ods → скачивание
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Сохранить как…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Сохранить как' })
    await expect(dialog).toBeVisible()
    await dialog.locator('select').first().selectOption('ods')
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('demo-book.ods')
    const savedPath = test.info().outputPath('styled.ods')
    await download.saveAs(savedPath)

    // переоткрыли: bold, ширина колонки и закрепление прочитаны из .ods
    // (ждём переключения книги по имени — иначе гонка со старым состоянием)
    await openFixtureFile(page, savedPath)
    await expect
      .poll(() => page.evaluate(() => window.__nv?.book().fileName ?? ''), { timeout: 3000 })
      .toBe('styled.ods')
    await expect
      .poll(() => page.evaluate(() => JSON.stringify(window.__nv!.style(1, 0))))
      .toBe(JSON.stringify({ bold: true }))
    expect(await page.evaluate(() => window.__nv!.colWidth(1))).toBe(150)
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })
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
    // данные 100 001 строка + запас пустых строк за контентом (novagrid-032)
    expect(book.rows).toBe(100_051)
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

    // ширина колонки и закрепление тоже едут в сессию (novagrid-050):
    // правки атрибутов листа сбрасывают дебаунс автосохранения сами
    await page.evaluate(() => window.__nv!.setColWidth(1, 150))
    await page.mouse.click(center.x, center.y, { button: 'right' })
    await page
      .getByRole('menuitem', { name: 'Закрепить области (выше и левее активной ячейки)' })
      .click()
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })

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
    // атрибуты листа восстановились из сессии (novagrid-050)
    await expect
      .poll(() => page.evaluate(() => window.__nv!.colWidth(1)))
      .toBe(150)
    expect(await api.freeze()).toEqual({ rows: 1, cols: 1 })
    const book = await nv(page).book()
    expect(book.dirty).toBe(true)
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник'])
  })

  test('несохранённая книга не попадает в «Недавние» (novagrid-026)', async ({ page }) => {
    await page.goto('/?testui=1')
    await page.getByRole('button', { name: 'Новая таблица' }).click()

    // в новой книге без файла что-то напечатано, дебаунс автосейва прожил —
    // но сессии у книг без файла больше нет: закрытие/крах не должен
    // оставлять в «Недавних» записи «Несохранённая книга»
    const api = nv(page)
    const center = await api.cellCenter(0, 0)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('9')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(0, 0)).toBe('9')
    await page.waitForTimeout(2200)

    await page.reload()
    await expect(page.locator('.start-recent-list')).toHaveCount(0)
    await expect(page.getByText('Несохранённая книга')).toHaveCount(0)
    await expect(page.locator('.start-empty')).toBeVisible()
  })

  test('открытые файлы попадают в «Недавние» сверху и переоткрываются оттуда (novagrid-022)', async ({
    page,
  }) => {
    // сначала обычная книга — её сессия должна уйти под свежее открытие
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')
    await page.waitForTimeout(2200) // дебаунс автосохранения сессии demo-book

    // большая книга (>150k ячеек): сессию автосохранение пропускает — в
    // «Недавних» останется только запись об открытии файла
    const lines = ['№;знач']
    for (let i = 1; i <= 80_000; i++) lines.push(`${i};${i * 2}`)
    const buffer = Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8')
    await page.setInputFiles('#nv-file-input', {
      name: 'big-recent.csv',
      mimeType: 'text/csv',
      buffer,
    })
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 30_000 })
      .toBe('1')
    // recordOpening летит асинхронно после загрузки книги (снимок байтов ~1 МБ
    // в IndexedDB) — навигация reload прервала бы незавершённую транзакцию,
    // и запись о открытии потерялась бы; даём записи уложиться
    await page.waitForTimeout(600)

    await page.reload()
    const items = page.locator('.start-recent-item')
    await expect(items).toHaveCount(2, { timeout: 10_000 })
    // свежее открытие — первым, с подписью «открыт …» (не «сохранено …»)
    await expect(items.nth(0)).toContainText('big-recent.csv')
    await expect(items.nth(0)).toContainText('открыт')
    await expect(items.nth(1)).toContainText('demo-book.xlsx')

    // клик переоткрывает сам файл (снимок байтов), а не сессию: dirty чист
    await items.nth(0).getByRole('button', { name: 'big-recent.csv' }).click()
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(2, 0) ?? ''), { timeout: 30_000 })
      .toBe('2')
    const book = await nv(page).book()
    expect(book.fileName).toBe('big-recent.csv')
    expect(book.dirty).toBe(false)
  })
})

test.describe('меню «Открыть» в книге (novagrid-030)', () => {
  test('кнопка «Открыть» показывает пикер и недавние файлы, клик переоткрывает', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    // второй файл: в «недавних» две записи, сверху — свежий
    await openFixtureFile(page, 'public/fixtures/ods-book.ods')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.book().fileName ?? ''), { timeout: 3000 })
      .toBe('ods-book.ods')
    // recordOpening летит асинхронно после загрузки книги — даём ему уложиться
    await page.waitForTimeout(400)

    // кнопка «Открыть» в книге раскрывает меню, а не сразу пикер
    const openBtn = page.getByRole('button', { name: 'Открыть', exact: true })
    const menu = page.locator('.open-menu')
    await expect(menu).toHaveCount(0)
    await openBtn.click()
    await expect(menu).toBeVisible()
    await expect(openBtn).toHaveAttribute('aria-expanded', 'true')

    // первый пункт — прежнее поведение кнопки: пикер (Ctrl+O)
    await expect(menu.getByRole('menuitem', { name: 'Открыть файл…' })).toBeVisible()

    // ниже — «Недавние»: оба файла, свежий сверху
    const rows = menu.locator('.open-menu-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).locator('.open-menu-name')).toHaveText('ods-book.ods')
    await expect(rows.nth(1).locator('.open-menu-name')).toHaveText('demo-book.xlsx')

    // клик по недавнему переоткрывает файл в этом окне (веб-режим), dirty чист
    await rows.nth(1).getByRole('menuitem', { name: 'demo-book.xlsx' }).click()
    await expect(menu).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => window.__nv?.book().fileName ?? ''), { timeout: 3000 })
      .toBe('demo-book.xlsx')
    const book = await nv(page).book()
    expect(book.tabs).toEqual(['Сотрудники', 'Справочник'])
    expect(book.dirty).toBe(false)

    // Esc закрывает меню; повторный клик по кнопке — тоже переключает
    await openBtn.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(openBtn).toHaveAttribute('aria-expanded', 'false')
  })

  test('«Забыть» убирает файл из меню «Открыть», пустой список честно подписан', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')
    await page.waitForTimeout(400) // recordOpening асинхронен

    await page.getByRole('button', { name: 'Открыть', exact: true }).click()
    const menu = page.locator('.open-menu')
    await expect(menu.locator('.open-menu-row')).toHaveCount(1)
    await menu.getByRole('menuitem', { name: 'Забыть' }).click()
    await expect(menu.locator('.open-menu-row')).toHaveCount(0)
    await expect(menu.getByText('Недавних файлов пока нет')).toBeVisible()
  })

  // ── несохранённые правки не теряются при закрытии (novagrid-033) ──────
  // браузер/PWA: системный вопрос beforeunload; полный диалог «Сохранить /
  // Не сохранять / Отмена» — только в десктоп-обёртке (проверяется ручным
  // смоуком сборки, e2e добраться до нативного окна не может)

  test('закрытие вкладки с правками спрашивает подтверждение beforeunload (novagrid-033)', async ({
    page,
  }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')

    // правка без сохранения → ● у имени
    const api = nv(page)
    const center = await api.cellCenter(1, 2)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('9')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(1, 2)).toBe('9')
    await expect.poll(() => api.book().then((b) => b.dirty)).toBe(true)

    // закрытие вкладки — системный вопрос; отказ (dismiss) оставляет вкладку
    // живой, правки на месте. Диалог ловится waitForEvent'ом: on('dialog')
    // в этой связке события не доставляет (см. дебаг novagrid-033)
    const dialogType = page
      .waitForEvent('dialog', { timeout: 5000 })
      .then(async (d) => {
        const type = d.type()
        await d.dismiss()
        return type
      })
      .catch(() => 'NO-DIALOG')
    await page.close({ runBeforeUnload: true })
    expect(await dialogType).toBe('beforeunload')
    expect(page.isClosed()).toBe(false)
    await expect.poll(() => api.cell(1, 2)).toBe('9')
  })

  test('закрытие вкладки без правок проходит без вопросов (novagrid-033)', async ({ page }) => {
    await page.goto('/?testui=1')
    await openFixtureFile(page, 'public/fixtures/demo-book.xlsx')
    await expect
      .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 3000 })
      .toBe('Иванов')
    await expect
      .poll(() =>
        nv(page)
          .book()
          .then((b) => b.dirty),
      )
      .toBe(false)

    // чистая книга: диалога нет, закрытие (с runBeforeUnload оно асинхронное)
    // доходит само
    const dialogType = page
      .waitForEvent('dialog', { timeout: 3000 })
      .then((d) => d.type())
      .catch(() => 'NO-DIALOG')
    await page.close({ runBeforeUnload: true })
    expect(await dialogType).toBe('NO-DIALOG')
    await expect.poll(() => page.isClosed(), { timeout: 5000 }).toBe(true)
  })

  // ── десктоп-обёртка: мок __TAURI__ (invoke/event/webview) повторяет мост
  // src/io/desktop.ts — проверяет веб-логику диалога закрытия без нативного
  // окна: синк dirty, сам диалог и решения «Отмена / Не сохранять».
  // Rust-часть (перехват CloseRequested, адресный emit) — cargo + смоук сборки.

  test('десктоп: close-ask у правок — Отмена оставляет, «Не сохранять» подтверждает закрытие (novagrid-033)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock: NonNullable<Window['__tauriMock']> = { calls: [], listeners: {} }
      window.__tauriMock = mock
      window.__TAURI__ = {
        core: {
          invoke: (cmd: string, args?: Record<string, unknown>) => {
            mock.calls.push({ cmd, args })
            return Promise.resolve(null)
          },
        },
        event: {
          listen: (event: string, handler: (e: { payload: unknown }) => void) => {
            ;(mock.listeners[event] ??= []).push(handler)
            return Promise.resolve(() => undefined)
          },
        },
        webview: { getCurrentWebviewWindow: () => ({ label: 'main' }) },
      }
    })
    await page.goto('/?testui=1')
    await page.getByRole('button', { name: 'Новая таблица' }).click()
    const api = nv(page)
    const center = await api.cellCenter(0, 0)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('5')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(0, 0)).toBe('5')

    // флаг dirty уехал в обёртку (по нему Rust решает, перехватывать ли крестик)
    const calls = () => page.evaluate(() => window.__tauriMock!.calls)
    await expect
      .poll(() =>
        calls().then((c) => c.some((x) => x.cmd === 'set_window_dirty' && x.args?.dirty === true)),
      )
      .toBe(true)

    // обёртка прислала close-ask → диалог с тройкой кнопок
    await page.evaluate(() =>
      (window.__tauriMock!.listeners['novagrid:close-ask'] ?? [])[0]({ payload: null }),
    )
    const dialog = page.getByRole('dialog', { name: 'Сохранить перед закрытием?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Книга не сохранена в файл')

    // «Отмена» — без confirm_close, остаёмся
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await calls().then((c) => c.some((x) => x.cmd === 'confirm_close'))).toBe(false)

    // повторный ask → «Не сохранять» закрывает окно (confirm_close)
    await page.evaluate(() =>
      (window.__tauriMock!.listeners['novagrid:close-ask'] ?? [])[0]({ payload: null }),
    )
    await dialog.getByRole('button', { name: 'Не сохранять' }).click()
    await expect(dialog).toHaveCount(0)
    await expect
      .poll(() => calls().then((c) => c.some((x) => x.cmd === 'confirm_close')))
      .toBe(true)
    // книга никуда не делась — правка на месте
    await expect.poll(() => api.cell(0, 0)).toBe('5')
  })

  test('десктоп: «Сохранить» в close-ask без пути — Сохранить как… → запись → confirm_close (novagrid-033)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const mock: NonNullable<Window['__tauriMock']> = { calls: [], listeners: {} }
      window.__tauriMock = mock
      window.__TAURI__ = {
        core: {
          invoke: (cmd: string, args?: Record<string, unknown>) => {
            mock.calls.push({ cmd, args })
            if (cmd === 'pick_save_book') return Promise.resolve('C:\\Books\\smoke.xlsx')
            return Promise.resolve(null)
          },
        },
        event: {
          listen: (event: string, handler: (e: { payload: unknown }) => void) => {
            ;(mock.listeners[event] ??= []).push(handler)
            return Promise.resolve(() => undefined)
          },
        },
        webview: { getCurrentWebviewWindow: () => ({ label: 'main' }) },
      }
    })
    await page.goto('/?testui=1')
    await page.getByRole('button', { name: 'Новая таблица' }).click()
    const api = nv(page)
    const center = await api.cellCenter(1, 0)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.press('7')
    await page.keyboard.press('Enter')
    await expect.poll(() => api.cell(1, 0)).toBe('7')

    // close-ask → «Сохранить» у книги без пути открывает «Сохранить как…»
    await page.evaluate(() =>
      (window.__tauriMock!.listeners['novagrid:close-ask'] ?? [])[0]({ payload: null }),
    )
    const closeDialog = page.getByRole('dialog', { name: 'Сохранить перед закрытием?' })
    await expect(closeDialog).toBeVisible()
    await closeDialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(closeDialog).toHaveCount(0)
    const saveAs = page.getByRole('dialog', { name: 'Сохранить как' })
    await expect(saveAs).toBeVisible()

    // сохранение: write_book_file по пути пикера → dirty снят → окно закрывается
    await saveAs.getByRole('button', { name: 'Сохранить', exact: true }).click()
    const calls = () => page.evaluate(() => window.__tauriMock!.calls)
    await expect
      .poll(() => calls().then((c) => c.some((x) => x.cmd === 'write_book_file')))
      .toBe(true)
    await expect
      .poll(() => calls().then((c) => c.some((x) => x.cmd === 'confirm_close')))
      .toBe(true)
    await expect.poll(() => api.book().then((b) => b.dirty)).toBe(false)
    await expect(saveAs).toHaveCount(0)
  })
})
