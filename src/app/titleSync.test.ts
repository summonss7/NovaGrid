import { describe, expect, it } from 'vitest'
import { APP_VERSION, windowTitleOf } from './titleSync'

/*
 * Текст заголовка окна (novagrid-037): «NovaGrid — <файл> — v<версия>».
 * Версия идёт из package.json — единственного источника (desktop-build.sh
 * сверяет с tauri.conf.json и Cargo.toml). Синхронизация с окном — e2e.
 */

describe('windowTitleOf — заголовок окна (novagrid-037)', () => {
  it('открытая книга: имя файла и версия после названия', () => {
    expect(windowTitleOf('счётчики.xlsx')).toBe(`NovaGrid — счётчики.xlsx — v${APP_VERSION}`)
  })

  it('без книги — только версия', () => {
    expect(windowTitleOf(null)).toBe(`NovaGrid — v${APP_VERSION}`)
  })

  it('версия читается из package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
