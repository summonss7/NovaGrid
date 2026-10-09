/*
 * Копирование в буфер с fallback: Clipboard API (Chromium/Secure context)
 * → скрытая textarea + execCommand (Firefox/Safari, http-режимы).
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // продолжаем legacy-путём
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
