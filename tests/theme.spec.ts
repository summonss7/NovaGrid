import { expect, test, type Page } from '@playwright/test'

/*
 * Этап 7.2 «Тёмная тема»: настройка «Система / Светлая / Тёмная» применяется
 * живьём — data-theme на <html>, канвас-грид перекрашивается без перезагрузки
 * (фон + чернила ячейки), чип фильтра в тёмном мятном, PWA theme-color следует
 * теме; «Система» живо реагирует на смену prefers-color-scheme; сохранённая
 * тёмная тема стоит до первого кадра (inline-скрипт в <head>, без React).
 *
 * Тип window.__nv объявлен в grid.spec.ts (общий для проекта тестов).
 */

const DARK_SURFACE = 'rgb(36, 40, 43)' // #24282b
const DARK_MINT = 'rgb(29, 58, 41)' // #1d3a29
const LIGHT_MINT = 'rgb(232, 248, 236)' // #e8f8ec

async function openDemoBook(page: Page) {
  await page.goto('/?testui=1')
  await page.setInputFiles('#nv-file-input', 'public/fixtures/demo-book.xlsx')
  await expect
    .poll(() => page.evaluate(() => window.__nv?.cell(1, 0) ?? ''), { timeout: 5000 })
    .toBe('Иванов')
}

/** RGB-пиксель канваса в CSS-координатах (канвас масштабируется на dpr). */
function canvasPixel(page: Page, x: number, y: number) {
  return page.evaluate(
    ([cx, cy]) => {
      const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      const d = ctx.getImageData(Math.round(cx * dpr), Math.round(cy * dpr), 1, 1).data
      return [d[0], d[1], d[2]] as const
    },
    [x, y],
  )
}

/**
 * Фон канваса: пустая ячейка вдали от данных (визуальная строка 3, колонка 8
 * — за пределами демо-книги) и от линий сетки (середина ячейки); верх
 * вьюпорта, чтобы точка оставалась в кадре и при открытой ленте чипов
 * фильтров (грид становится короче).
 */
function canvasBg(page: Page) {
  return canvasPixel(page, 44 + 8 * 96 + 48, 30 + 3 * 30 + 15)
}

/** Сколько «чернильных» пикселей в ячейке (текст читаем — краска есть). */
async function inkPixelsInCell(page: Page, row: number, col: number): Promise<number> {
  return page.evaluate(
    ({ row, col }) => {
      const canvas = document.querySelector('.grid-canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const dpr = window.devicePixelRatio || 1
      const m = window.__nv!.cellMetrics()
      // фон берём соседней пустой ячейкой той же строки — за данными книги
      const bgPix = ctx.getImageData(
        Math.round((m.rowHeaderW + 8 * m.colW + m.colW / 2) * dpr),
        Math.round((m.headerH + row * m.rowH + m.rowH / 2) * dpr),
        1,
        1,
      ).data
      const x0 = Math.round((m.rowHeaderW + col * m.colW + 3) * dpr)
      const y0 = Math.round((m.headerH + row * m.rowH + 3) * dpr)
      const w = Math.floor(m.colW * dpr) - 6
      const h = Math.floor(m.rowH * dpr) - 6
      const data = ctx.getImageData(x0, y0, w, h).data
      let ink = 0
      for (let i = 0; i < data.length; i += 4) {
        const dist = Math.max(
          Math.abs(data[i] - bgPix[0]),
          Math.abs(data[i + 1] - bgPix[1]),
          Math.abs(data[i + 2] - bgPix[2]),
        )
        if (dist > 60) ink++
      }
      return ink
    },
    { row, col },
  )
}

async function pickTheme(page: Page, label: string) {
  await page.click('.toolbar-settings')
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.click(`.settings-dialog .settings-seg >> text=${label}`)
  await page.keyboard.press('Escape')
}

test.describe('тёмная тема (7.2)', () => {
  test('переключение живьём: канвас, ячейка читаема, чип фильтра, PWA theme-color, персист @smoke', async ({
    page,
  }) => {
    await openDemoBook(page)

    // светлая по умолчанию: канвас белый, текст «Иванов» нарисован чернилами
    expect(await canvasBg(page)).toEqual([255, 255, 255])
    expect(await inkPixelsInCell(page, 1, 0)).toBeGreaterThan(50)

    // чип фильтра в светлой теме — мятный фон, чернильный текст
    const ivanov = await page.evaluate(() => window.__nv!.cellCenter(1, 0))
    await page.mouse.click(ivanov.x, ivanov.y, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Фильтровать: A = «Иванов»' }).click()
    await expect(page.locator('.filter-chip')).toHaveCount(1)
    const chipLight = await page.evaluate(() => {
      const el = document.querySelector('.filter-chip')!
      const cs = getComputedStyle(el)
      return {
        bg: cs.backgroundColor,
        ink: getComputedStyle(el.querySelector('.filter-chip-text')!).color,
      }
    })
    expect(chipLight.bg).toBe(LIGHT_MINT)
    expect(chipLight.ink).toBe('rgb(43, 43, 43)')

    // переключение в тёмную без перезагрузки
    await pickTheme(page, 'Тёмная')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.toolbar')).toHaveCSS('background-color', DARK_SURFACE)
    // PWA theme-color следует теме
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content,
        ),
      )
      .toBe('#24282b')
    // канвас перекрашен: фон тёмный, ячейка по-прежнему читаема светлыми чернилами
    await expect.poll(async () => JSON.stringify(await canvasBg(page))).toBe('[25,28,30]')
    expect(await inkPixelsInCell(page, 1, 0)).toBeGreaterThan(50)

    // чип фильтра — тёмный мятный, светлый текст
    const chipDark = await page.evaluate(() => {
      const el = document.querySelector('.filter-chip')!
      const cs = getComputedStyle(el)
      return {
        bg: cs.backgroundColor,
        ink: getComputedStyle(el.querySelector('.filter-chip-text')!).color,
      }
    })
    expect(chipDark.bg).toBe(DARK_MINT)
    expect(chipDark.ink).toBe('rgb(232, 234, 231)')

    // персист: перезагрузка сохраняет тёмную тему (и она не вспыхивает светлым)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content,
        ),
      )
      .toBe('#24282b')

    // обратно в светлую — тоже живьём (канвас возвращается к белому)
    await openDemoBook(page)
    await pickTheme(page, 'Светлая')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(async () => JSON.stringify(await canvasBg(page))).toBe('[255,255,255]')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content,
        ),
      )
      .toBe('#ededeb')
  })

  test('«Система» живо реагирует на смену prefers-color-scheme', async ({ page }) => {
    await openDemoBook(page)
    await pickTheme(page, 'Система')

    // режим ОС тёмный → тема тёмная (канвас тоже)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content,
        ),
      )
      .toBe('#24282b')
    await expect.poll(async () => JSON.stringify(await canvasBg(page))).toBe('[25,28,30]')

    // и обратно в светлый — без перезагрузки
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(async () => JSON.stringify(await canvasBg(page))).toBe('[255,255,255]')
  })

  test('сохранённая тёмная тема стоит до первого кадра (inline-скрипт, без React)', async ({
    page,
  }) => {
    // настройка в localStorage + модуль приложения не грузится: data-theme
    // обязан поставить inline-скрипт из <head> — он выполняется до отрисовки
    await page.addInitScript(() => {
      localStorage.setItem(
        'novagrid-settings',
        JSON.stringify({ state: { theme: 'dark' }, version: 0 }),
      )
    })
    await page.route('**/src/app/main.tsx', (route) => route.abort())
    await page.goto('/?testui=1', { waitUntil: 'domcontentloaded' })

    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(
      await page.evaluate(
        () =>
          (document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null)?.content,
      ),
    ).toBe('#24282b')
  })
})
