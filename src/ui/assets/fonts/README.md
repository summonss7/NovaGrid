# Self-hosted шрифты

Файлы `*.woff2` скачаны один раз из Google Fonts и хранятся в репозитории —
приложение не обращается к внешним CDN (приватность и офлайн, DESIGN-SYSTEM §3).

Оба семейства — **переменные шрифты**: один файл покрывает всю ось начертаний
(`font-weight: 100 900` у Montserrat, `300 800` у Open Sans в `fonts.css`),
поэтому на четыре нужных веса (Montserrat 600/700, Open Sans 400/600) хватает
четырёх файлов — по подмножеству `cyrillic` и `latin` на семейство.

| Семейство | Файлы | Подмножества | Лицензия |
|---|---|---|---|
| Montserrat | `montserrat-{latin,cyrillic}.woff2` | latin, cyrillic | SIL OFL 1.1 |
| Open Sans | `open-sans-{latin,cyrillic}.woff2` | latin, cyrillic | SIL OFL 1.1 |

Тексты лицензий: <https://fonts.google.com/specimen/Montserrat/about>,
<https://fonts.google.com/specimen/Open+Sans/about> (SIL Open Font License 1.1).
