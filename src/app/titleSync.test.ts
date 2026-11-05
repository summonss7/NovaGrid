import { describe, expect, it } from 'vitest'
import { APP_BUILD_DATE, APP_VERSION, windowTitleOf } from './titleSync'

/*
 * Текст заголовка окна (novagrid-037): «NovaGrid — <файл> — v<версия>».
 * Версия идёт из package.json — единственного источника (desktop-build.sh
 * сверяет с tauri.conf.json и Cargo.toml). novagrid-055 добавил дату сборки:
 * «NovaGrid — <файл> — v1.27.0 от 05.11.2026». Синхронизация с окном — e2e.
 */

describe('windowTitleOf — заголовок окна (novagrid-037)', () => {
  it('открытая книга: имя файла, версия и дата сборки (novagrid-055)', () => {
    expect(windowTitleOf('счётчики.xlsx')).toBe(
      `NovaGrid — счётчики.xlsx — v${APP_VERSION} от ${APP_BUILD_DATE}`,
    )
  })

  it('без книги — только версия с датой', () => {
    expect(windowTitleOf(null)).toBe(`NovaGrid — v${APP_VERSION} от ${APP_BUILD_DATE}`)
  })

  it('версия читается из package.json, дата — дд.мм.гггг', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(APP_BUILD_DATE).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
  })
})
