/*
 * Регистрация сервис-воркера (Этап 5.1). Стратегия 'prompt': новая версия
 * НЕ перезагружает страницу молча — App показывает плашку «Доступна новая
 * версия» с кнопкой «Обновить». Сессия при обновлении не теряется: правки
 * автосохраняются в IndexedDB (дебаунс 1 с + pagehide) и переживут reload;
 * сам reload происходит только по явному клику пользователя.
 *
 * iOS Safari игнорирует user-scalable=no — гасим его жест масштабирования
 * страницы: пинч над таблицей зумит таблицу (5.3), а не весь документ.
 */

import { registerSW } from 'virtual:pwa-register'

type ReloadFn = () => void
type UpdateListener = (reload: ReloadFn) => void

let listeners: UpdateListener[] = []
let updateFn: ((reload: boolean) => Promise<void>) | undefined

/** Подписка на «доступна новая версия»; отписка — вызовом результата. */
export function onPwaUpdate(listener: UpdateListener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export function registerServiceWorker(): void {
  updateFn = registerSW({
    onNeedRefresh() {
      const reload: ReloadFn = () => {
        void updateFn?.(true)
      }
      for (const l of listeners) l(reload)
    },
    // офлайн-оболочка готова — молча: это норма, а не событие
    onOfflineReady() {
      /* без уведомления */
    },
  })

  // iOS: жест пинча страницы (Safari позволяет его вопреки meta viewport)
  document.addEventListener('gesturestart', (e) => e.preventDefault())
}
