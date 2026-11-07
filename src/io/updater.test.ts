/*
 * Юнит-тесты стора OTA-обновлений (novagrid-036): калитка тихой проверки
 * (не чаще раза в сутки), исходы ручной/тихой проверки («последняя версия»
 * показывается явно, недоступный центр — ошибка только у ручной), цикл
 * установки (скачивание → сессия → swap). Мост к обёртке и автосохранение
 * замоканы; localStorage — стаб (vitest работает в node).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// novagrid-063: платформа переключается переменной — моки обоих мостов
// живут одновременно, тесты мобильного OTA идут с mobileMode = true
let mobileMode = false
vi.mock('./desktop', () => ({
  isDesktop: () => !mobileMode,
  onDesktopUpdaterProgress: () => () => undefined,
  desktopUpdateCheck: vi.fn(),
  desktopUpdateDownload: vi.fn(),
  desktopUpdateApply: vi.fn(),
}))
vi.mock('./mobile', () => ({
  isTauriMobile: () => mobileMode,
  mobileUpdateCheck: vi.fn(),
  mobileUpdateDownload: vi.fn(),
  mobileUpdateInstall: vi.fn(),
  onMobileUpdaterProgress: () => () => undefined,
}))
vi.mock('../storage/autosave', () => ({
  flushSession: vi.fn(),
}))

import { desktopUpdateApply, desktopUpdateCheck, desktopUpdateDownload } from './desktop'
import { mobileUpdateCheck, mobileUpdateDownload, mobileUpdateInstall } from './mobile'
import { flushSession } from '../storage/autosave'
import { shouldSilentCheck, useUpdaterStore } from './updater'

// localStorage в окружении node отсутствует — минимальный стаб
const ls = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
  setItem: (k: string, v: string) => void ls.set(k, String(v)),
  removeItem: (k: string) => void ls.delete(k),
  clear: () => void ls.clear(),
})

const DAY_MS = 24 * 60 * 60 * 1000

const checkResult = (over: Partial<Awaited<ReturnType<typeof desktopUpdateCheck>>>) => ({
  status: 'latest' as const,
  current: '1.19.0',
  latest: '1.19.0',
  notes: null,
  publishedAt: null,
  asset: null,
  error: null,
  ...over,
})

beforeEach(() => {
  ls.clear()
  mobileMode = false
  vi.clearAllMocks()
  vi.mocked(desktopUpdateCheck).mockResolvedValue(checkResult({}))
  vi.mocked(desktopUpdateDownload).mockResolvedValue('C:\\Temp\\novagrid-update-1.exe')
  vi.mocked(desktopUpdateApply).mockResolvedValue(undefined)
  vi.mocked(flushSession).mockResolvedValue(undefined)
  useUpdaterStore.setState({
    status: 'idle',
    dialogOpen: false,
    current: '',
    latest: null,
    notes: null,
    publishedAt: null,
    asset: null,
    downloaded: 0,
    total: 0,
    error: null,
  })
})

describe('shouldSilentCheck', () => {
  it('ещё не проверяли — проверяем', () => {
    expect(shouldSilentCheck(null, Date.now())).toBe(true)
  })

  it('проверяли меньше суток назад — молчим', () => {
    const now = Date.now()
    expect(shouldSilentCheck(now - 2 * 60 * 60 * 1000, now)).toBe(false)
  })

  it('прошло больше суток — проверяем', () => {
    const now = Date.now()
    expect(shouldSilentCheck(now - DAY_MS - 1000, now)).toBe(true)
  })

  it('мобильный период 10 минут: 5 минут назад — молчим, 15 — проверяем (novagrid-063)', () => {
    const now = Date.now()
    expect(shouldSilentCheck(now - 5 * 60 * 1000, now, 10 * 60 * 1000)).toBe(false)
    expect(shouldSilentCheck(now - 15 * 60 * 1000, now, 10 * 60 * 1000)).toBe(true)
  })
})

describe('useUpdaterStore.check', () => {
  it('тихая проверка «последняя версия» ничего не показывает и пишет метку времени', async () => {
    await useUpdaterStore.getState().check(false)
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('idle')
    expect(s.dialogOpen).toBe(false)
    expect(s.current).toBe('1.19.0')
    expect(ls.get('novagrid-update-last-check')).toBeTruthy()
  })

  it('тихая проверка с обновлением открывает диалог', async () => {
    vi.mocked(desktopUpdateCheck).mockResolvedValue(
      checkResult({
        status: 'available',
        latest: '1.20.0',
        asset: { name: 'novagrid-1.20.0-portable-release.exe', url: 'https://x/e.exe', size: 5, sha256: 'abc' },
      }),
    )
    await useUpdaterStore.getState().check(false)
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('available')
    expect(s.dialogOpen).toBe(true)
    expect(s.asset?.sha256).toBe('abc')
  })

  it('ручная проверка «последняя версия» показывает это явно', async () => {
    await useUpdaterStore.getState().check(true)
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('latest')
    expect(s.dialogOpen).toBe(true)
  })

  it('недоступный центр у ручной проверки — ошибка, у тихой — молчание', async () => {
    vi.mocked(desktopUpdateCheck).mockResolvedValue(
      checkResult({ status: 'network-error', latest: null, error: 'timeout' }),
    )
    await useUpdaterStore.getState().check(true)
    expect(useUpdaterStore.getState().status).toBe('error')
    expect(useUpdaterStore.getState().error).toBe('timeout')

    useUpdaterStore.setState({ status: 'idle', dialogOpen: false, error: null })
    await useUpdaterStore.getState().check(false)
    expect(useUpdaterStore.getState().status).toBe('idle')
  })
})

describe('useUpdaterStore.install', () => {
  const setAvailable = () =>
    useUpdaterStore.setState({
      status: 'available',
      asset: { name: 'e.exe', url: 'https://x/e.exe', size: 2048, sha256: 'abc' },
    })

  it('скачивает, фиксирует сессию и делает swap', async () => {
    setAvailable()
    await useUpdaterStore.getState().install()
    expect(desktopUpdateDownload).toHaveBeenCalledWith('https://x/e.exe', 'abc', 2048)
    expect(flushSession).toHaveBeenCalled()
    expect(desktopUpdateApply).toHaveBeenCalledWith('C:\\Temp\\novagrid-update-1.exe')
    expect(useUpdaterStore.getState().status).toBe('restarting')
  })

  it('ошибка скачивания — статус error, swap не вызывается', async () => {
    setAvailable()
    vi.mocked(desktopUpdateDownload).mockRejectedValue(new Error('sha256 mismatch'))
    await useUpdaterStore.getState().install()
    expect(useUpdaterStore.getState().status).toBe('error')
    expect(useUpdaterStore.getState().error).toContain('sha256')
    expect(desktopUpdateApply).not.toHaveBeenCalled()
  })
})

describe('useUpdaterStore (мобильная Android, novagrid-063)', () => {
  const setMobileAvailable = () =>
    useUpdaterStore.setState({
      status: 'available',
      asset: { name: 'NovaGrid-1.30.0-android-release.apk', url: 'https://x/n.apk', size: 8192, sha256: 'apk' },
    })

  beforeEach(() => {
    mobileMode = true
    vi.mocked(mobileUpdateCheck).mockResolvedValue(checkResult({ current: '1.29.0' }))
    vi.mocked(mobileUpdateDownload).mockResolvedValue('/data/user/0/app.novagrid.mobile/cache/updates/n.apk')
    vi.mocked(mobileUpdateInstall).mockResolvedValue('started')
  })

  it('тихая проверка с APK-обновлением открывает баннер через мобильный мост', async () => {
    vi.mocked(mobileUpdateCheck).mockResolvedValue(
      checkResult({
        status: 'available',
        current: '1.29.0',
        latest: '1.30.0',
        asset: { name: 'NovaGrid-1.30.0-android-release.apk', url: 'https://x/n.apk', size: 8192, sha256: 'apk' },
      }),
    )
    await useUpdaterStore.getState().check(false)
    const s = useUpdaterStore.getState()
    expect(s.status).toBe('available')
    expect(s.dialogOpen).toBe(true)
    expect(mobileUpdateCheck).toHaveBeenCalled()
    expect(desktopUpdateCheck).not.toHaveBeenCalled()
  })

  it('установка: скачивает APK и открывает системный установщик (installing)', async () => {
    setMobileAvailable()
    await useUpdaterStore.getState().install()
    expect(mobileUpdateDownload).toHaveBeenCalledWith('https://x/n.apk', 'apk', 8192)
    expect(mobileUpdateInstall).toHaveBeenCalledWith(
      '/data/user/0/app.novagrid.mobile/cache/updates/n.apk',
    )
    // мобильная установка не делает rename-swap и не фиксирует сессию на выход
    expect(desktopUpdateApply).not.toHaveBeenCalled()
    expect(flushSession).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().status).toBe('installing')
  })

  it('needs-permission — отдельный статус после открытия настроек источника', async () => {
    setMobileAvailable()
    vi.mocked(mobileUpdateInstall).mockResolvedValue('needs-permission')
    await useUpdaterStore.getState().install()
    expect(useUpdaterStore.getState().status).toBe('needs-permission')
  })

  it('ошибка скачивания APK — статус error без вызова установки', async () => {
    setMobileAvailable()
    vi.mocked(mobileUpdateDownload).mockRejectedValue(new Error('network: boom'))
    await useUpdaterStore.getState().install()
    expect(useUpdaterStore.getState().status).toBe('error')
    expect(mobileUpdateInstall).not.toHaveBeenCalled()
  })
})
