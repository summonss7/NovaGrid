/*
 * Мобильный режим (Этап 5.2): coarse-указатель (пальцы — телефоны и iPad)
 * или узкий экран. Раскладка переключается CSS-медиа-выражением с тем же
 * условием, а хук нужен интерактиву (свёрнутая строка формул и т.п.).
 */

import { useEffect, useState } from 'react'

export const MOBILE_MEDIA = '(pointer: coarse), (max-width: 760px)'

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}
