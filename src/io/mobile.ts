/*
 * Мост к мобильной обёртке Tauri Android/iOS (novagrid-057/058). Признак —
 * window.__TAURI__.dialog: плагин dialog инжектится только мобильной веткой
 * lib.rs (десктоп регистрирует rfd-команды, но не плагины) — так один
 * веб-бандл различает платформы без пересборки фронтенда.
 *
 * Назначение моста — сохранение книг. Веб-путей сохранения в Android WebView
 * нет вовсе (проверено на эмуляторе, novagrid-058): FSA showSaveFilePicker
 * висит без системного UI, запись в хэндл открытого файла падает
 * InvalidStateError (грант протухает), a[download] с blob игнорируется без
 * DownloadListener, navigator.share отсутствует. Посему — системный SAF-диалог
 * (ACTION_CREATE_DOCUMENT, plugin-dialog) и запись по content:// через
 * ContentResolver (plugin-fs). Открытие книг мосту не нужно: input[type=file]
 * получает системный пикер от wry.
 *
 * npm-пакеты @tauri-apps сознательно не подключаются (как и в desktop.ts) —
 * глобальный window.__TAURI__ (withGlobalTauri), браузерная сборка не меняется.
 */

/** Мобильная обёртка Tauri (Android/iOS): плагин dialog инжектирован. */
export function isTauriMobile(): boolean {
  return typeof window !== 'undefined' && window.__TAURI__?.dialog !== undefined
}

/** Фильтры системного диалога сохранения по формату книги. */
const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  xlsx: { name: 'Excel (.xlsx)', extensions: ['xlsx'] },
  ods: { name: 'OpenDocument (.ods)', extensions: ['ods'] },
  csv: { name: 'CSV (.csv)', extensions: ['csv'] },
  nvgridx: { name: 'Снапшот NovaGrid', extensions: ['nvgridx'] },
}

/**
 * Системный «Сохранить как…» мобильной обёртки: SAF-пикер от плагина dialog.
 * Возвращает путь (content://…) или null — отмена.
 */
export function mobilePickSavePath(
  defaultName: string,
  format: 'xlsx' | 'ods' | 'csv' | 'nvgridx',
): Promise<string | null> {
  return window.__TAURI__!.dialog!.save({
    defaultPath: defaultName,
    filters: [FILTERS[format]],
  })
}

/** Запись книги по пути SAF-диалога (JSON-массив байтов — книги таблиц малы). */
export async function mobileWriteFile(path: string, buffer: ArrayBuffer): Promise<void> {
  await window.__TAURI__!.fs!.writeFile(path, Array.from(new Uint8Array(buffer)))
}
