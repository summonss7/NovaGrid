import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 4 «Формулы и помощь» (КТ): e2e повторяет главное — «ввёл формулу —
 * получил сумму отфильтрованного» на сценарии ТЗ (132 строки Иванов+10 000),
 * проверяет живой пересчёт при правках, строку формул, автодополнение,
 * ошибки человеческим языком, справочник «?» и чужие формулы (∛, fixed-book).
 *
 * Тип window.__nv объявлен в grid.spec.ts (общий для проекта тестов).
 */

const IVANOV_SUM = 1_320_000 // 132 «Иванов + 10 000»

function nv(page: Page) {
  return {
    ready: () => page.waitForFunction(() => window.__nv !== undefined),
    cellText: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellText(row, col), { row, col }),
    cell: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cell(row, col), { row, col }),
    cellCenter: (row: number, col: number) =>
      page.evaluate(({ row, col }) => window.__nv!.cellCenter(row, col), { row, col }),
    visibleRows: () => page.evaluate(() => window.__nv!.visibleRows()),
    formulaInfo: (row: number, col: number) =>
      page.evaluate(
        ({ row, col }) => window.__nv!.formulaInfo(row, col),
        { row, col },
      ),
    activeRef: () => page.evaluate(() => window.__nv!.activeRef()),
  }
}

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBeTruthy()
}

async function openFormulaBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/formula-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Стол')
}

/** Клик по ячейке и ввод формулы как руками: печать + Enter. */
async function typeFormula(page: Page, row: number, col: number, text: string) {
  const center = await nv(page).cellCenter(row, col)
  await page.mouse.click(center.x, center.y)
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

test.describe('КТ-4: ввёл формулу — получил сумму отфильтрованного', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('фильтр 132 строки → =SUMIF → 1 320 000 → правка суммы пересчитывает', async ({ page }) => {
    const api = nv(page)

    // сценарий ТЗ: ПКМ на «Иванов» в A, ПКМ на «10000» в C
    let center = await api.cellCenter(1, 0)
    await page.mouse.click(center.x, center.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Фильтровать: A = «Иванов»' }).click()
    await expect.poll(() => api.visibleRows().then((r) => r?.length ?? 0)).toBe(180)

    const rowWith10000 = await page.evaluate(() => {
      const vis = window.__nv!.visibleRows() ?? []
      for (const r of vis) if (window.__nv!.cell(r, 2) === '10000') return r
      return -1
    })
    center = await api.cellCenter(rowWith10000, 2)
    await page.mouse.click(center.x, center.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Фильтровать: C = «10000»' }).click()
    await expect.poll(() => api.visibleRows().then((r) => r?.length ?? 0)).toBe(132)

    // формула в свободной ячейке F2: сумма отфильтрованного — те же два
    // условия, что и ПКМ-фильтр (A = Иванов И C = 10000), ровно 132 строки
    await typeFormula(page, 1, 5, '=SUMIFS(C2:C501;A2:A501;"Иванов";C2:C501;10000)')
    const info = await api.formulaInfo(1, 5)
    expect(info).not.toBeNull()
    expect(info!.display).toBe(String(IVANOV_SUM))
    expect(info!.error).toBeNull()
    expect(info!.frozen).toBe(false)
    // Σ статус-бара видит вычисленное значение формулы в выделении
    center = await api.cellCenter(1, 5)
    await page.mouse.click(center.x, center.y)
    await expect(page.locator('.status-metrics')).toContainText(
      /1[\s\u00a0\u202f]320[\s\u00a0\u202f]000/,
    )

    // живой пересчёт: правка одной суммы на 11000 — строка выходит из
    // условий формулы, сумма падает на 10 000
    const editRow = ((await api.visibleRows()) ?? [])[1] ?? 1
    await typeFormula(page, editRow, 2, '11000')
    await expect
      .poll(() => api.formulaInfo(1, 5).then((i) => i?.display ?? ''))
      .toBe(String(IVANOV_SUM - 10000))

    // Ctrl+Z возвращает правку и пересчитывает обратно
    await page.keyboard.press('Control+z')
    await expect
      .poll(() => api.formulaInfo(1, 5).then((i) => i?.display ?? ''))
      .toBe(String(IVANOV_SUM))
    // фильтры живы: по-прежнему видны ровно 132 строки сценария ТЗ
    await expect.poll(() => api.visibleRows().then((r) => r?.length ?? 0)).toBe(132)
  })

  test('цепочка зависимостей: формула от формулы пересчитывается', async ({ page }) => {
    const api = nv(page)
    await typeFormula(page, 0, 5, '=SUM(C2:C10)')
    await typeFormula(page, 1, 6, '=F1*2')
    expect((await api.formulaInfo(1, 6))?.display).toBe(
      String(2 * Number((await api.formulaInfo(0, 5))!.display)),
    )
    await typeFormula(page, 1, 2, '1') // C2 → 1
    const f1 = Number((await api.formulaInfo(0, 5))!.display)
    expect((await api.formulaInfo(1, 6))?.display).toBe(String(f1 * 2))
  })

  test('ошибки — человеческим языком, и в ячейке, и в строке формул', async ({ page }) => {
    const api = nv(page)
    await typeFormula(page, 0, 5, '=SUM(')
    expect((await api.formulaInfo(0, 5))?.error).toBe('Не хватает закрывающей скобки')
    expect(await api.cellText(0, 5)).toBe('Не хватает закрывающей скобки')

    const center = await api.cellCenter(0, 5)
    await page.mouse.click(center.x, center.y)
    await expect(page.locator('.formula-error')).toHaveText('Не хватает закрывающей скобки')

    await typeFormula(page, 1, 5, '=FOO(1)')
    expect((await api.formulaInfo(1, 5))?.error).toContain('Неизвестная функция FOO')

    await typeFormula(page, 2, 5, '=A9:A2')
    expect((await api.formulaInfo(2, 5))?.error).toContain('снизу вверх')
  })
})

test.describe('строка формул (4.3): показ и живое редактирование', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('формула видна в строке формул, правка из строки пересчитывает ячейку', async ({ page }) => {
    const api = nv(page)
    await typeFormula(page, 0, 5, '=SUM(C2:C10)')
    const center = await api.cellCenter(0, 5)
    await page.mouse.click(center.x, center.y)
    await expect(page.locator('.formula-input')).toHaveValue('=SUM(C2:C10)')

    // правка в строке формул: Enter фиксирует
    const bar = page.locator('.formula-input')
    await bar.click()
    await bar.press('Control+a')
    const petrovSum = await page.evaluate(() => {
      let s = 0
      for (let r = 1; r <= 500; r++)
        if (window.__nv!.cell(r, 0) === 'Петров') s += Number(window.__nv!.cell(r, 2))
      return s
    })
    await bar.fill(`=SUMIF(A2:A501;"Петров";C2:C501)`)
    await bar.press('Enter')
    await expect
      .poll(() => api.formulaInfo(0, 5).then((i) => i?.display ?? ''))
      .toBe(String(petrovSum))
    // фокус вернулся гриду — стрелки двигают выделение
    await page.keyboard.press('ArrowDown')
    expect(await api.activeRef()).not.toBe('F1')

    // Esc в строке формул отменяет правку
    await bar.click()
    await bar.press('Control+a')
    await bar.fill('=123')
    await bar.press('Escape')
    await expect
      .poll(() => api.formulaInfo(0, 5).then((i) => i?.display ?? ''))
      .toBe(String(petrovSum))
  })
})

test.describe('режим указания: «=» + клики по ячейкам (novagrid-020)', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('= → клик C2 → «-» → клик C3 → Enter: формула собралась кликами и считает', async ({
    page,
  }) => {
    const api = nv(page)
    const target = await api.cellCenter(0, 3)
    await page.mouse.click(target.x, target.y)
    await page.keyboard.type('=')
    const editor = page.locator('.grid-editor')
    await expect(editor).toBeVisible()

    const c2 = await api.cellCenter(1, 2)
    const c3 = await api.cellCenter(2, 2)
    await page.mouse.click(c2.x, c2.y) // =C2
    await expect(editor).toHaveValue('=C2')
    await page.keyboard.type('-') // фокус остался в редакторе
    await page.mouse.click(c3.x, c3.y) // =C2-C3
    await expect(editor).toHaveValue('=C2-C3')
    await page.keyboard.press('Enter')

    const info = await api.formulaInfo(0, 3)
    expect(info?.source).toBe('=C2-C3')
    expect(info?.display).toBe(String(Number(await api.cell(1, 2)) - Number(await api.cell(2, 2))))
    expect(info?.error).toBeNull()
  })

  test('протяжка от ячейки вставляет диапазон =SUM(C2:C4)', async ({ page }) => {
    const api = nv(page)
    const target = await api.cellCenter(1, 3)
    await page.mouse.click(target.x, target.y)
    // скобки сразу, каретка между ними — протяжка вставит диапазон внутрь
    await page.keyboard.type('=SUM()')
    await page.keyboard.press('ArrowLeft')
    const editor = page.locator('.grid-editor')
    await expect(editor).toBeVisible()

    const c2 = await api.cellCenter(1, 2)
    const c4 = await api.cellCenter(3, 2)
    await page.mouse.move(c2.x, c2.y)
    await page.mouse.down()
    await page.mouse.move(c4.x, c4.y, { steps: 5 })
    await page.mouse.up()
    await expect(editor).toHaveValue('=SUM(C2:C4)')
    await page.keyboard.press('Enter')
    const expected = (await Promise.all([api.cell(1, 2), api.cell(2, 2), api.cell(3, 2)]))
      .map(Number)
      .reduce((a, b) => a + b, 0)
    expect((await api.formulaInfo(1, 3))?.display).toBe(String(expected))
  })

  test('указание из строки формул: клик по ячейке вставляет адрес и в неё', async ({ page }) => {
    const api = nv(page)
    const target = await api.cellCenter(0, 4)
    await page.mouse.click(target.x, target.y)
    const bar = page.locator('.formula-input')
    await bar.click()
    await bar.fill('=')
    await page.keyboard.press('Escape') // попап подсказок не должен ловить клик
    const c2 = await api.cellCenter(1, 2)
    await page.mouse.click(c2.x, c2.y)
    await expect(bar).toHaveValue('=C2')
    await bar.press('Enter')
    expect((await api.formulaInfo(0, 4))?.display).toBe(await api.cell(1, 2))
  })

  test('Esc отменяет указание, клик мимо формулы работает как раньше', async ({ page }) => {
    const api = nv(page)
    const target = await api.cellCenter(0, 9) // свободная J1 демо-книги
    await page.mouse.click(target.x, target.y)
    await page.keyboard.type('=C2+') // незавершённая формула
    await page.keyboard.press('Escape') // отмена правки
    const b2 = await api.cellCenter(1, 1)
    await page.mouse.click(b2.x, b2.y)
    expect(await api.activeRef()).toBe('B2')
    expect(await api.cell(0, 9)).toBe('')
  })
})

test.describe('автосумма Σ: стоя на ячейке → выбрать ячейки → =СУММ (novagrid-020)', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('Σ → протяжка C2:C4 → в ячейку-приёмник вставляется =SUM и считает', async ({ page }) => {
    const api = nv(page)
    const target = await api.cellCenter(0, 3) // стоим на D1
    await page.mouse.click(target.x, target.y)
    await page.getByRole('button', { name: 'Автосумма' }).click()
    await expect(page.locator('.status-sum-pick')).toContainText('D1')

    const c2 = await api.cellCenter(1, 2)
    const c4 = await api.cellCenter(3, 2)
    await page.mouse.move(c2.x, c2.y)
    await page.mouse.down()
    await page.mouse.move(c4.x, c4.y, { steps: 5 })
    await page.mouse.up()

    const info = await api.formulaInfo(0, 3)
    expect(info?.source).toBe('=SUM(C2:C4)')
    const expected = (await Promise.all([api.cell(1, 2), api.cell(2, 2), api.cell(3, 2)]))
      .map(Number)
      .reduce((a, b) => a + b, 0)
    expect(info?.display).toBe(String(expected))
    expect(await api.activeRef()).toBe('D1') // остались на ячейке-приёмнике
  })

  test('Σ + клавиатура: стрелки и Shift+стрелки, Enter применяет; Esc отменяет', async ({
    page,
  }) => {
    const api = nv(page)
    const target = await api.cellCenter(0, 3)
    await page.mouse.click(target.x, target.y)
    await page.getByRole('button', { name: 'Автосумма' }).click()

    // без мыши: перейти на C1, расширить до C1:C2, Enter (С1 — текст шапки,
    // SUM его игнорирует, считается только C2)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Enter')
    const info = await api.formulaInfo(0, 3)
    expect(info?.source).toBe('=SUM(C1:C2)')
    expect(info?.display).toBe(await api.cell(1, 2))

    // Esc до выбора — режим снимается, клики просто выделяют
    const other = await api.cellCenter(1, 4)
    await page.mouse.click(other.x, other.y)
    await page.getByRole('button', { name: 'Автосумма' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.status-sum-pick')).toBeHidden()
    const c3 = await api.cellCenter(2, 2)
    await page.mouse.click(c3.x, c3.y)
    expect(await api.cell(1, 4)).toBe('')
  })
})

test.describe('автодополнение (4.4)', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('=SU → список функций, Tab подставляет, подсказка аргументов', async ({ page }) => {
    const api = nv(page)
    const center = await api.cellCenter(0, 5)
    await page.mouse.click(center.x, center.y)
    await page.keyboard.type('=SU')

    const popup = page.locator('.assist-popup')
    await expect(popup).toBeVisible()
    await expect(popup.locator('.assist-item-name').first()).toHaveText('SUM')
    await expect(popup).toContainText('SUMIF')

    // Tab подставляет функцию и открывающую скобку
    await page.keyboard.press('Tab')
    const editor = page.locator('.grid-editor')
    await expect(editor).toBeVisible()
    expect(await editor.inputValue()).toBe('=SUM(')

    // внутри вызова — подпись аргументов
    await page.keyboard.type('C2:C10;')
    await expect(popup.locator('.assist-args')).toBeVisible()
    await expect(popup.locator('.assist-args')).toContainText('SUM')
    await expect(popup.locator('.assist-args')).toContainText('число1')

    // Esc закрывает подсказку, повторный Esc отменяет правку
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden()
    expect(await api.cellText(0, 5)).toBe('')
  })
})

test.describe('справочник «?» (4.5)', () => {
  test.beforeEach(async ({ page }) => {
    await openDemoBook(page)
  })

  test('карточки формул с живым примером, поиск, клавиши, приёмы; F1 и Esc', async ({ page }) => {
    await page.getByRole('button', { name: 'Справка (?)' }).click()
    const dialog = page.locator('.help-dialog')
    await expect(dialog).toBeVisible()

    // карточка с сигнатурой и живым примером на текущей таблице
    const anyCard = dialog.locator('.help-card').first()
    await expect(anyCard.locator('.help-card-sig')).toContainText('(')
    await expect(anyCard.locator('.help-card-example')).toContainText('→')
    expect(await dialog.locator('.help-card').count()).toBeGreaterThanOrEqual(25)

    // поиск сужает список до одной
    await dialog.getByLabel('Найти функцию…').fill('VLOOKUP')
    await expect(dialog.locator('.help-card')).toHaveCount(1)
    await expect(anyCard).toContainText('VLOOKUP')

    // горячие клавиши и приёмы
    await dialog.getByRole('tab', { name: 'Горячие клавиши' }).click()
    await expect(dialog.locator('.help-keys')).toBeVisible()
    await expect(dialog.locator('.help-keys')).toContainText('Ctrl+F')
    await dialog.getByRole('tab', { name: 'Приёмы' }).click()
    await expect(dialog.locator('.help-tip').first()).toBeVisible()

    // Esc закрывает; F1 открывает снова
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('F1')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Закрыть справку' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('чужие формулы (4.6): кэш значений и ∛', () => {
  test('поддерживаемая считается, чужая показывает кэш с меткой', async ({ page }) => {
    const api = nv(page)
    await openFormulaBook(page)

    // SUM(B2:B4) — наша: 4+10+6 = 20, пересчитывается
    const sum = await api.formulaInfo(4, 1)
    expect(sum?.source).toBe('=SUM(B2:B4)')
    expect(sum?.display).toBe('20')
    expect(sum?.frozen).toBe(false)

    // AVERAGE(C2:C4) — наша: (2500+900+1200)/3
    expect((await api.formulaInfo(4, 2))?.display).toContain('1533.33')

    // SUMPRODUCT — чужая: кэш 28600, метка ∛, оригинал в строке формул
    const foreign = await api.formulaInfo(5, 1)
    expect(foreign?.source).toBe('=SUMPRODUCT(B2:B4,C2:C4)')
    expect(foreign?.display).toBe('28600')
    expect(foreign?.frozen).toBe(true)
    expect(foreign?.error).toBeNull()

    const center = await api.cellCenter(5, 1)
    await page.mouse.click(center.x, center.y)
    await expect(page.locator('.formula-frozen')).toBeVisible()
    await expect(page.locator('.formula-input')).toHaveValue('=SUMPRODUCT(B2:B4,C2:C4)')

    // правка данных не ломает чужую формулу (остаётся кэш) и пересчитывает свою
    await typeFormula(page, 1, 1, '14')
    expect((await api.formulaInfo(4, 1))?.display).toBe('30')
    expect((await api.formulaInfo(5, 1))?.display).toBe('28600')
  })
})
