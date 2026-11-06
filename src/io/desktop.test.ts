import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDesktop } from './desktop'
import { isTauriMobile } from './mobile'

// Контракт платформенной развилки (novagrid-058): Windows-обёртка Tauri —
// window.__TAURI__ БЕЗ плагина dialog; мобильные обёртки Android/iOS —
// window.__TAURI__ С .dialog (плагин инжектит только мобильная ветка lib.rs);
// браузер — моста нет вовсе. Тест фиксирует контракт: появление диалог-плага
// на десктопе (или исчезновение с мобильного) должно быть осознанным.
// vitest работает в node — window стабится целиком (паттерн theme.test.ts).
describe('платформенная развилка обёрток Tauri', () => {
  type TauriShape = { core?: unknown; event?: unknown; dialog?: unknown }

  const stubTauri = (v: TauriShape | undefined) => {
    vi.stubGlobal('window', v === undefined ? {} : { __TAURI__: v })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('браузер (без window.__TAURI__): не десктоп и не мобильная обёртка', () => {
    stubTauri(undefined)
    expect(isDesktop()).toBe(false)
    expect(isTauriMobile()).toBe(false)
  })

  it('Windows-обёртка (__TAURI__ без .dialog): десктоп', () => {
    stubTauri({ core: {}, event: {} })
    expect(isDesktop()).toBe(true)
    expect(isTauriMobile()).toBe(false)
  })

  it('мобильная обёртка Android/iOS (__TAURI__ с .dialog): не десктоп', () => {
    stubTauri({ core: {}, event: {}, dialog: { save: async () => null } })
    expect(isDesktop()).toBe(false)
    expect(isTauriMobile()).toBe(true)
  })
})
