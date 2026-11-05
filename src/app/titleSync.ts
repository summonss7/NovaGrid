/*
 * Заголовок окна (novagrid-037): «NovaGrid — <файл> — v<версия>» сверху в
 * строке названия. В браузере/PWA это document.title (вкладка), в десктоп-
 * обёртке — ещё и нативный заголовок окна через команду set_window_title
 * (Tauri сама document.title не переносит). Единственный источник версии —
 * package.json (desktop-build.sh сверяет его с tauri.conf.json/Cargo.toml).
 */

import pkg from '../../package.json'
import { gridStore } from '../core/store'
import { desktopSetTitle, isDesktop } from '../io/desktop'
import { dict } from '../i18n'

export const APP_VERSION: string = pkg.version
/** Дата этой сборки (novagrid-55): подставляется vite define при билде. */
export const APP_BUILD_DATE: string = __NV_BUILD_DATE__

/** Текст заголовка: без открытой книги — только версия с датой (novagrid-055). */
export function windowTitleOf(fileName: string | null): string {
  const v = `v${APP_VERSION} ${dict().versionDateOf} ${APP_BUILD_DATE}`
  return fileName ? `NovaGrid — ${fileName} — ${v}` : `NovaGrid — ${v}`
}

function applyTitle(fileName: string | null): void {
  const title = windowTitleOf(fileName)
  if (document.title !== title) document.title = title
  if (isDesktop()) void desktopSetTitle(title).catch(() => undefined)
}

/**
 * Синхронизация со стором: заголовок меняется при открытии/закрытии книги
 * и «Сохранить как…» (новое имя файла). Возвращает отписку.
 */
export function installTitleSync(): () => void {
  applyTitle(gridStore.getState().fileName)
  let lastName: string | null = gridStore.getState().fileName
  return gridStore.subscribe((st) => {
    if (st.fileName === lastName) return
    lastName = st.fileName
    applyTitle(st.fileName)
  })
}
