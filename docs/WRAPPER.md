# Десктоп- и Android-обёртки NovaGrid (Этап 7.5 novagrid-018; мобильная линия novagrid-057)

Нативные оболочки **Tauri 2** поверх одного веб-приложения. Десктоп: значок в
меню «Пуск», нативное меню «Файл», диалоги открытия/сохранения и файловые
ассоциации .xlsx/.xls/.ods/.csv/.docx/.doc/.nvgridx без браузера. Android: APK
из того же Rust-крейта `desktop/` (мобильная ветка `lib.rs` + `gen/android`),
файлы — системные пикеры SAF и «Открыть с помощью» (intent-filter на
Excel/Word/CSV, novagrid-068). Веб-часть не меняется — обе обёртки грузят ту же
production-сборку (`dist/`), что и PWA; в браузере/PWA всё работает как раньше.
iOS — та же мобильная ветка, сборка требует macOS/Xcode (раздел «Android и iOS»
ниже). Параллельная поддержка платформ («меняется что-то → во всех версиях»):
один фронтенд, один крейт, версия из `package.json` проверяется перед каждой
сборкой обеими build-скриптами.

## Что внутри

| Путь | Роль |
|---|---|
| `desktop/` | Rust-крейт Tauri 2 в lib-паттерне (novagrid-058): `src/main.rs` — тонкий бин винды; `src/lib.rs` — развилка `run()`: `#[cfg(desktop)]` → модуль `desktop_app` (вся прежняя логика: окно, нативное меню, rfd-диалоги, IPC, доп. окна книг novagrid-023, OTA `updater.rs` из центра Aila novagrid-036), `#[cfg(mobile)]` → мобильный WebView-билдер с плагинами dialog+fs; `tauri.conf.json` (окно 1280×800, CSP), `tauri.android.conf.json` (оверлей: identifier `app.novagrid.mobile`), `Cargo.toml` (виндо-крейты — в desktop-секции target.cfg), `installer.iss` (Inno Setup), `icons/`, `lib/WebView2Loader.dll` |
| `desktop/gen/android/` | Android-проект (`tauri android init`), коммитится (каркас правится руками); кэши сборки (`build`, `.gradle`) исключает его собственный .gitignore. `buildSrc/.../BuildTask.kt` запатчен на переносимый вызов CLI (`node ../node_modules/@tauri-apps/cli/tauri.js`), иначе генератор печёт абсолютный путь машины сборки. Подпись release: `novagrid-release.keystore` (закоммичен — репозиторий приватный, утеря keystore = осиротевшие обновления) + `keystore.properties` (пароль; в git НЕ входит, в backups/ попадает) |
| `scripts/desktop-build.sh` | Сборка десктопа: фронтенд → exe (frontend внутри) → портабельная папка+zip+голый OTA-exe в `builds/` → установщик Inno Setup в `builds/` (release) → публикация релиза в центр обновлений Aila (novagrid-036) → автообновление развёрнутой копии `C:\NovaGrid` (release) |
| `scripts/android-build.sh` | Сборка APK (novagrid-059): сверка версий → фронтенд → `tauri android build` → подписанный APK в `builds/novagrid-<ver>-android-<тип>/` |
| `scripts/deploy-portable.sh` | Обновление развёрнутой портативной копии в `C:\NovaGrid` (novagrid-021): копирует exe+DLL из портабельной сборки и сверяет md5; вызывается релизной desktop-build.sh и годится для ручного запуска |
| `scripts/desktop-dev.sh` | Dev-режим: vite devserver :5173 + `cargo run` без встраивания (окно грузит dev-сервер, HMR живой) |
| `scripts/android-dev.sh` | Dev-режим Android: vite на 0.0.0.0:5173 + `tauri android dev <device>` (сборка либы; на Windows финальный запуск — ▶ Run в Android Studio, которую открывает CLI; headless-петля — через android:build debug + adb, см. раздел «Android и iOS») |
| `scripts/make-desktop-icons.mjs` | Иконки из `public/favicon.svg` (растеризация playwright-chromium, многослойный .ico); перегенерация лишь при смене знака — иконки закоммичены |
| `scripts/make-android-icons.mjs` | Иконки Android из того же знака: сам пишет mipmap в `gen/android` (novagrid-066: адаптивная маска лаунчера — знак в безопасной зоне 72%, фон #000000, legacy как плитка винды; `tauri icon` больше не используется — он растягивал знак на весь слой и маска резала углы) |
| `src/io/desktop.ts` | Мост фронтенда: всё за `isDesktop()` (признак `window.__TAURI__` без `.dialog`), браузерная сборка ни одного вызова не выполняет; npm-пакеты `@tauri-apps` сознательно не подключаются |
| `src/io/mobile.ts` | Мост мобильной обёртки (novagrid-058): `isTauriMobile()` по `window.__TAURI__.dialog`, `mobilePickSavePath`/`mobileWriteFile` — SAF-диалог + запись `content://`; в Android WebView веб-пути сохранения не работают (FSA-пикер висит, `a[download]` и `navigator.share` нет); capability `desktop/capabilities/mobile.json` (android+iOS) |

Интеграция в `App.tsx`: нативный «Файл → Открыть» (мультивыбор с v1.7) → тот
же конвейер `openFile`; `Ctrl+S` — прямая запись по пути (`desktopPath`
в сторе — аналог FSA-хэндла); «Сохранить как…» — нативный диалог; книги
из аргументов запуска открываются на старте; нативное меню шлёт события
`novagrid:menu` тем же обработчикам; язык интерфейса (ru/en/ro/sk/ar,
novagrid-070) фронтенд синхронизирует командой `set_menu_lang` — обёртка
пересобирает нативное меню и переводит заголовки/фильтры диалогов
открытия/сохранения (новые окна книг наследуют язык); service worker в обёртке не
регистрируется (контент уже в exe). «Недавние» (novagrid-022): открытые
книги пишутся в IndexedDB вместе с полным путём и переоткрываются из
«Недавних» по `read_book_bytes` с диска; профиль WebView2
(`%LOCALAPPDATA%\app.novagrid.desktop`) персистентный — список переживает
перезапуски exe. Несколько книг одновременно (novagrid-023, v1.7): каждая
книга — своё окно (см. ниже).

## Защита правок при закрытии (v1.16, novagrid-033)

Крестик «грязного» окна не закрывает книгу молча. Фронтенд при каждой смене
флага `dirty` синхронизирует его в Rust (`set_window_dirty`, команда
привязывается к метке вызывающего окна); `CloseRequested` у окна из реестра
гасится (`prevent_close`), и окну **адресно** (`emit_to` по метке) летит
событие `novagrid:close-ask` — фронтенд показывает диалог
«Сохранить / Не сохранять / Отмена»:

- «Сохранить»: есть путь и формат прямой записи (.xlsx/.csv) — книга
  пишется и окно закрывается; книги без пути (новая/.xls/.ods) — открывается
  «Сохранить как…», окно закроется после успешной записи (отмена пикера —
  книга остаётся открытой); ошибка записи оставляет диалог открытым.
- «Не сохранять» — закрытие без записи, «Отмена» — остаёмся в книге.

Решение исполняет команда `confirm_close` (`destroy()` — без повторного
`CloseRequested`, иначе цикл). Чистые окна в реестр не входят и закрываются
сразу. Адресность важна и для событий меню (исправлено попутно): слушатели
`novagrid:menu`/`novagrid:close-ask` подписываются target'ом на метку
своего окна (`window.__TAURI__.webview.getCurrentWebviewWindow().label`),
а Rust шлёт `emit_to(label)` — при нескольких окнах книг чужие окна
событий не получают (бродкаст `emit` в Tauri дошёл бы до всех).

## Заголовок окна (v1.20, novagrid-037)

Строка названия окна показывает открытую книгу и версию программы с датой
сборки (дата — vite define `__NV_BUILD_DATE__`, novagrid-055):
«NovaGrid — счётчики.xlsx — v1.27.0 от 05.11.2026» (без книги —
«NovaGrid — v1.27.0 от 05.11.2026»).
Tauri не переносит `document.title` в нативный заголовок сама, поэтому
фронтенд при каждой смене `fileName` в сторе вызывает команду
`set_window_title` (привязана к метке вызывающего окна, как
`set_window_dirty`); в браузере/PWA тот же текст идёт в `document.title`
(вкладка). Версия читается из `package.json` — единственного источника
(сборка сверяет его с `tauri.conf.json`/`Cargo.toml`).

## Пререквизиты (Windows)

На машине сборки (этой) стоит и проверено:

1. **Node.js 24** (та же, что для веб-части) — `npm ci`.
2. **Rust** через rustup, тулчейн **GNU**: `rustup toolchain install stable-x86_64-pc-windows-gnu`.
   GNU, а не MSVC: среда не тянет VS Build Tools; MSYS2 даёт gcc/dlltool.
3. **MSYS2** (ucrt64): `C:\Users\<user>\msys64\ucrt64\bin` — gcc/линкер для GNU-тулчейна; скрипты добавляют его в PATH сами.
4. **WebView2Loader.dll** — уже в репозитории (`desktop/lib/`); линкуется напрямую
   (мингвский ld читает экспорты DLL, `.cargo/config.toml` ведёт `-L native` туда),
   тот же DLL кладётся рядом с exe в сборках. Сам WebView2 — системный Evergreen,
   на Windows 10/11 уже есть.
5. **Inno Setup 6** (только для установщика, per-user): `winget install --id JRSoftware.InnoSetup --scope user`.
   Нет — скрипт честно соберёт только портабельную сборку.
6. **Android SDK** (только для APK): `%LOCALAPPDATA%\Android\Sdk` (проще всего —
   Android Studio; нужны platform-tools, platforms android-36+, build-tools, ndk,
   emulator). JDK — из комплекта (`C:\Program Files\Android\Android Studio\jbr`,
   OpenJDK 21). Скрипты android-* сами ставят `ANDROID_HOME`/`NDK_HOME`/`JAVA_HOME`
   по этим путям (env-переменные имеют приоритет) и сами выбирают свежий NDK.
7. **Rust-таргеты Android** (однократно): `rustup target add aarch64-linux-android
   armv7-linux-androideabi i686-linux-android x86_64-linux-android`.

Ограничение версии: `tauri = "=2.12.1"` — 2.12.3+ тянет из loader-архива MSVC-объекты
с зависимостями от MSVC-CRT, которые не собираются GNU-тулчейном (подробности —
комментарии в `desktop/Cargo.toml` и `desktop/.cargo/config.toml`).

## Команды

```bash
npm run desktop:icons   # перегенерация иконок (только при смене знака)
npm run desktop:dev     # окно + vite devserver (HMR)
npm run desktop:build           # release: dist/ → exe → builds/novagrid-<ver>-portable-release(.zip) → setup.exe → обновить C:\NovaGrid
npm run desktop:build debug     # debug: только портабельная папка+zip
scripts/deploy-portable.sh      # вручную обновить C:\NovaGrid (по умолчанию — свежая release-папка текущей версии)

npm run android:icons           # иконки Android из знака → gen/android (маска лаунчера учтена)
npm run android:dev             # dev: vite 0.0.0.0:5173 + tauri android dev (запуск — ▶ Run в Android Studio)
npm run android:build           # release APK (aarch64) → builds/novagrid-<ver>-android-release/
npm run android:build debug     # debug APK (aarch64+x86_64 — телефон и эмулятор)
npm run android:build -- release aarch64 x86_64   # свои таргеты
```

Версия берётся из `package.json` (единый источник с веб-приложением), тип —
суффиксом в имени артефакта:

- `builds/novagrid-1.5.0-setup-release.exe` — установщик (пер-пользовательский,
  без UAC: `%LOCALAPPDATA%\Programs\NovaGrid`; ярлыки «Пуск»/рабочий стол;
  чекбокс файловых ассоциаций);
- `builds/novagrid-1.5.0-portable-release/` (+ `.zip`) — exe + WebView2Loader.dll,
  запускается без установки.

`builds/` и `desktop/target/` в `.gitignore` — артефакты в git не попадают.

## Развёрнутая копия C:\NovaGrid

На машине владельца развёрнута портативная копия приложения: `C:\NovaGrid\NovaGrid.exe`
+ `WebView2Loader.dll` — папка на диске C:, вне репозитория. Правило проекта
(карточка novagrid-021, 12.10.2026): **при выпуске каждой новой версии эта копия
обновляется автоматически** — без отдельной просьбы владельца.

- Механизм: `desktop-build.sh` (release) в конце сборки вызывает
  `scripts/deploy-portable.sh` — exe и DLL копируются из свежей
  `builds/novagrid-<версия>-portable-release/`, совпадение exe проверяется md5.
- Вручную (догнать пропущенный релиз): `scripts/deploy-portable.sh` — без
  аргументов возьмёт папку текущей версии из `package.json`; можно передать
  путь к конкретной портабельной папке.
- Края: папки `C:\NovaGrid` нет — скрипт сообщит и завершится без ошибки
  (машина без развёрнутой копии); exe запущен — копирование упадёт «file in
  use»: закрыть окно NovaGrid и повторить. С v1.19 запущенный exe уже не
  мешает: приложение обновляет себя само (см. ниже), локальный деплой остаётся
  страховкой на случай релиза «в обход» канала.

## OTA-обновления из центра Aila (десктоп — v1.19 novagrid-036, Android — v1.30 novagrid-063)

Десктоп следит за своей версией через **центр обновлений Aila** (концепция —
`D:\Scheduler\UPDATES-SYSTEM.md`, канон; паттерн общий с Al-Navi). PWA-ветка
не затронута: веб обновляет себя Service Worker'ом, как раньше.

- **Проверка**: `GET https://aila.skillcoin.pp.ua/updates/novagrid/manifest.json`
  (манифест v2), сравнение `versionName` с версией сборки (`CARGO_PKG_VERSION`,
  единый источник — `package.json`; `desktop-build.sh` сверяет все три файла).
  Тихая проверка при старте — не чаще раза в сутки (метка времени в
  localStorage, только главное окно); явная — «Справка → Проверить
  обновления…». Исходы: «✓ У вас последняя версия» / «⬆ Доступна версия X»
  с «что новым» (notes из CHANGELOG) и кнопкой «Обновить». Недоступный центр —
  не ошибка (молчим в тихом режиме, «Повторить» в ручном).
- **Обновление**: скачивание выбранного ассета (голый portable-exe из
  `builds/…-portable-release.exe`; setup-инсталляторы и zip-ы канал тоже
  несёт, но клиент их не ставит) в `%TEMP%` с прогрессом и обязательной
  сверкой sha256 из манифеста → rename-swap запущенного exe (запущенный
  `NovaGrid.exe` → `NovaGrid.exe.old`, свежий на его место, запуск нового
  бинарника, выход старого) → `.old` удаляется при следующем старте
  (`updater::cleanup_old` в setup). Работает из любого места установки —
  пути считаются от `std::env::current_exe()`. Перед перезапуском текущая
  книга сбрасывается в сессию (кнопка «Продолжить» на старте вернёт правки).
- **Публикация**: `desktop-build.sh` (release) после сборки вызывает
  `node D:\Scheduler\tools\publish-update.cjs novagrid --notes-file CHANGELOG.md`
  — сервер Aila копирует артефакты в `updates/novagrid/`, атомарно пишет
  манифест (sha256, только после файлов), дописывает `history.jsonl` и
  отправляет «📦 Обновление novagrid X» в «Хаб ИИ». Инструмент диспетчера
  на машине нет — публикация пропускается с предупреждением; сервер
  недоступен — сборка падает (поднять: `schtasks /run /tn AilaRestart`).
  Откат — старые артефакты не удаляются, вернуть версию = переопубликовать
  её файлы.
- **Тестовая подмена**: переменная окружения `NOVAGRID_UPDATES_URL`
  переопределяет адрес манифеста — так живая проверка гоняет полный цикл
  swap+перезапуск на подменённом манифесте, не трогая рабочий канал.

### Мобильная ветка Android (v1.30, novagrid-063)

Тот же канал и манифест v2, но ассет обновления — APK (с v1.30 публикуется
вместе с десктопными артефактами: 4 файла в манифесте). Отличия от десктопа:

- **Проверка** — команды Rust-модуля `desktop/src/mobile_updater.rs`
  (`updater_check` / `updater_download` / `updater_install`, регистрируются
  только на Android; iOS обновляет App Store). Тихая проверка при старте
  чаще десктопа — раз в 10 минут (короткие мобильные сессии, образец
  lecards-027; та же персистентная метка localStorage). Ручная — кнопка
  «⬆ Проверить обновления» в справочнике «?» (меню «Справка» на мобильной
  нет). Выбор ассета: APK без x86/armeabi-v7a в имени, arm64/aarch64
  предпочитается.
- **Скачивание** — в `cacheDir` со сверкой sha256 и событием прогресса
  `novagrid:updater-progress` (то же, что слушает десктопный диалог).
- **Установка** — не swap, а системный установщик: всю Android-логику ведёт
  Kotlin-хелпер `gen/android/.../MobileUpdateHelper.kt` (проверка appop,
  настройки `MANAGE_UNKNOWN_APP_SOURCES`, FileProvider + `ACTION_VIEW`;
  proguard-keep — класс зовётся из Rust по имени, без keep R8 его выкинет),
  Rust вызывает его одним статическим методом — прямой JNI-путь установки
  ронял поток NoSuchMethodError'ом на `GetMethodID`. Манифест заявляет
  `REQUEST_INSTALL_PACKAGES`; если appop не выдан — состояние
  needs-permission («разрешите установку», кнопка «Повторить» после выдачи).
  Учтите: на некоторых устройствах финальное подтверждение может перехватить
  Google Play Protect («harmful app») — на телефонах семьи ставится
  «Установить всё равно», на тестовом эмуляторе он блокирует вглухую.
- **Сеть** — `reqwest` с `rustls` (schannel на Android нет). Дефолтный
  rustls-путь reqwest 0.13 тянет верификатор rustls-platform-verifier,
  которому на Android нужна JNI-инициализация с AAR-компонентой в gradle —
  без неё процесс падает паникой при первом же TLS-соединении (поймано
  живым зондом на эмуляторе). Поэтому OTA-клиент собирает rustls-конфиг сам
  с вшитыми корнями `webpki-roots` (Mozilla) и отдаёт его в
  `use_preconfigured_tls` — системные JNI-компоненты не нужны, корни едут
  с APK и обновляются вместе с приложением (центр за Cloudflare,
  сертификаты публичные). Недоступный центр деградирует молча, как на
  десктопе (§5 концепции).

## Файловые ассоциации

Inno Setup (`desktop/installer.iss`) регистрирует ProgId `NovaGrid.Book`
и добавляет NovaGrid в «Открыть с помощью» для
`.xlsx/.xls/.ods/.csv/.docx/.doc/.nvgridx` (`OpenWithProgids`, HKCU); Word
появился в v1.31 (novagrid-068) вместе с чтением .docx/.doc. Владелец по
умолчанию (Excel/LibreOffice/Word) **не перехватывается** — пользователь
назначает NovaGrid приложением по умолчанию сам, если хочет. Открытие:
Explorer запускает `NovaGrid.exe "<путь к книге>"` — аргументы читаются на
старте (IPC `startup_books`, однократно) и книги открываются тем же конвейером,
что и drag-and-drop в веб-версии. `.nvgridx` (v1.8, Этап 7.6) — зашифрованная
капсула-снапшот книги: двойной клик в облачной папке открывает её в NovaGrid,
парольную фразу спросит веб-диалог; нативные диалоги открытия/сохранения
знают фильтр `nvgridx`.

Android (v1.31, novagrid-068): в манифесте у `MainActivity` — intent-filter
`ACTION_VIEW` по MIME-типам Excel/ODS/CSV/Word (без scheme — ловит любые
`content://` с нужным типом). `MainActivity` копирует поток URI в
`cacheDir/nv-open.tmp` и держит имя файла; фронтенд забирает файл двумя
путями: холодный старт — pull после загрузки (JS-мост
`__NovaGridAndroid.takePending()` + Rust-команда `mobile_read_open_intent`
в `lib.rs`, бинарный IPC), тёплое открытие в живом окне — толчок
`evaluateJavascript` в `window.__nvAndroidOpen` (подписка `onAndroidOpenPush`
в `src/io/mobile.ts`). Капсула одноразовая — повторное чтение не
переоткрывает файл; `launchMode=singleTask` доставляет повторные открытия
через `onNewIntent`.

## Несколько книг одновременно (v1.7, novagrid-023)

Каждая книга — своё нативное окно (классическая модель Windows-редакторов);
несколько запусков приложения живут рядом (общий персистентный профиль
WebView2 не конфликтует). Первый файл открывается в текущем окне, остальные —
в новых через `WebviewWindowBuilder` с URL `index.html?file=<путь>`;
диалог «Файл → Открыть» — мультивыбор (`rfd::pick_files`); перетащенные
вне пути файлы (у HTML5 File пути нет) едут через staging-обёртку:
`stage_book_bytes` → окно `?staged=<id>&name=<имя>` → `take_staged_book`
(бинарный IPC, снимки ≤16 МБ, кэш последних 8). Меню «Файл» строится
на каждое окно, событие `novagrid:menu` уходит только в окно-источник
(фокус), иначе все окна открыли бы диалог разом. В браузере/PWA поведение
прежнее: несколько книг = вкладки браузера, открывается первая.

## Проверка (смоук)

Ручной смоук на машине сборки (результаты — в CHANGELOG этапа):

1. Запуск портабельного exe с аргументом-книгой: окно открывается, книга
   загружена (данные, вкладки, Σ) — путь ассоциаций.
2. Запуск с несколькими книгами-аргументами (v1.7): окно на каждую книгу,
   в каждом — своя (проверка novagrid-023).
3. «Файл → Открыть…» (нативный диалог rfd, мультивыбор) — книги открываются;
   «Файл → Сохранить как…» — файл по выбранному пути перечитывается.
4. Снапшот .nvgridx (v1.8): «Сохранить как…» → формат .nvgridx с фразой —
   капсула пишется нативным диалогом; двойной клик по ней (после ассоциаций)
   открывает книгу после ввода фразы.
5. Установщик: тихая установка per-user, ярлык запускает приложение,
   деинсталлятор убирает ассоциации.
6. Закрытие с правками (v1.16): правка ячейки → крестик → диалог
   «Сохранить перед закрытием?» → «Не сохранять» закрывает, «Отмена»
   оставляет; чистое окно закрывается без вопросов.

## Android и iOS (мобильная линия novagrid-057)

Мобильная версия — не отдельное приложение, а ещё один выход того же кода:
фронтенд один (мобильная раскладка ≤760px давно в вебе), Rust-крейт `desktop/`
один (развилка `#[cfg(mobile)]` в `lib.rs`: WebView-билдер + плагины
`tauri-plugin-dialog`/`tauri-plugin-fs` вместо нативного меню и rfd),
генерат `desktop/gen/android` коммитится, как и остальной каркас. Capacitor
рассматривался и отвергнут (второй стек/мост рядом с Tauri ломает требование
«меняется что-то → во всех версиях»); чистая PWA отвергнута (нужен именно APK).

**Отличия мобильного рантайма** (выяснены живой проверкой на эмуляторе,
novagrid-058): файловые операции в Android WebView проходят только через
системные пикеры SAF — открытие через `input[type=file]` (пикер от wry),
сохранение через плагин dialog (`ACTION_CREATE_DOCUMENT`) + запись `content://`
плагином fs. Веб-пути (FSA-пикер, `a[download]`, `navigator.share`) в WebView
не работают — фронтенд различает среду по `window.__TAURI__.dialog`
(`src/io/mobile.ts`), пути/хэндлы на мобильных не персистятся, каждое
сохранение — SAF-диалог.

**Строки состояния и edge-to-edge** (novagrid-064): MainActivity вызывал
`enableEdgeToEdge()`, а с targetSdk 35+ Android сам принудительно рисует окно
на весь экран — контент заходил под статус-бар (часы, настройки) и навигационную
панель. Откатить edge-to-edge на новых Android нельзя — вместо этого
`MainActivity` сдвигает контейнер `android.R.id.content` (куда wry кладёт
WebView) на insets системных панелей (`ViewCompat.setOnApplyWindowInsetsListener`),
а фон окна в `themes.xml` (values / values-night) = фон приложения из
`tokens.css` (белый / #191C1E) — полосы сверху/снизу выглядят продолжением
приложения, окно лежит строго между панелями.

**Подпись release** (novagrid-059): keystore `novagrid-release.keystore` создан
keytool (RSA 2048, 10000 дней, alias `NovaGrid`), лежит в `desktop/gen/android/`
и закоммичен — репозиторий приватный, а утеря keystore осиротила бы все
обновления приложения. Пароль — в `desktop/gen/android/keystore.properties`,
который .gitignore gen/android сознательно прячет из git, но backup.ps1
копирует в архивы (секрет незаменим). Сборка без keystore.properties даёт
`*-unsigned.apk` с предупреждением (не встанет на телефон). Подпись проверяет
`apksigner verify` из build-tools — скрипт.

**Сборка**: `scripts/android-build.sh [debug|release] [targets…]` — версии
package.json / tauri.conf.json / Cargo.toml сверены (расхождение = отказ),
фронтенд собран, APK положен в `builds/novagrid-<ver>-android-<тип>/`.
versionCode/versionName в `gen/android/app/tauri.properties` CLI перегенерит
из версии конфига (1.28.0 → 1028000). Проверено headless, без IDE.

**Dev-режим**: `npm run android:dev [-- <устройство>]` — сначала запустить
эмулятор (`emulator -avd lecards_test`); скрипт поднимает vite на `:5173`
**с `--host 0.0.0.0`** (эмулятор не видит localhost хоста, tauri адресует
devUrl на LAN-IP — иначе вечно «Waiting for your frontend dev server»),
определяет устройство (первый `adb devices`, иначе аргумент — без устройства
CLI виснет в интерактивном выборе) и запускает `tauri android dev <device>`:
Rust-либа собирается, jniLibs ссылаются, и **на Windows CLI открывает проект
в Android Studio** — финальный запуск через кнопку ▶ Run в IDE (поведение
cargo-mobile2, tauri-apps/tauri#6098); веб-правки подхватываются live из
dev-сервера, Rust-правки — пересборкой. Headless-альтернатива без IDE
(проверена в novagrid-058): `npm run android:build debug x86_64` →
`adb install -r <apk>` → `adb shell am start -n app.novagrid.mobile/.MainActivity`.

**Живой смоук на эмуляторе** (как в novagrid-058): установить APK
(`adb install -r <apk>`), запустить → «Открыть файл…» → системный пикер →
книга открылась (листы, формулы) → правка ячейки через строку формул →
«⋯ → Сохранить как…» → SAF-диалог SAVE → файл в `/sdcard/Download`;
вытащить `adb pull` и проверить exceljs (значение правки, формулы, листы).

**iOS** (novagrid-060): кодовая база готова — мобильная ветка `lib.rs` и
capability `mobile.json` (`platforms: ["android", "iOS"]`) платформонезависимы,
overlay `desktop/tauri.ios.conf.json` (тот же `app.novagrid.mobile`,
`withGlobalTauri`) лежит в репозитории. Windows-хост дальше не продвигается:
в prebuilt tauri-cli для Windows подкоманды `ios` нет вообще
(`unrecognized subcommand 'ios'`, проверено на 2.12.4) — codegen Xcode-проекта
делает только macOS-хост, поэтому `gen/apple` в git отсутствует сознательно.
Сборка на Mac (пошагово):

1. macOS 13+, Xcode 15+ с CLI-инструментами (`xcode-select --install`),
   Rust (`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`), Node 20+.
2. В корне репозитория: `npm ci`.
3. `npx tauri ios init` — создаст `desktop/gen/apple` (Xcode-проект,
   identifier подтянется из `tauri.ios.conf.json`).
4. Иконки: `npx tauri icon desktop/icons/source-1024.png` — разложит знак
   в `gen/apple/Assets.xcassets` (исходник коммитится, приём тот же, что у
   Android-иконок).
5. Подпись: открыть `desktop/gen/apple` в Xcode → таргет NovaGrid →
   Signing & Capabilities → выбрать свой Team (Apple ID). Для App Store —
   зарегистрировать Bundle ID `app.novagrid.mobile` на developer.apple.com.
6. Сборка: `npx tauri ios build` — `.ipa` для устройства (release);
   `--export-method app-store-connect` + выгрузка Transporter/Xcode —
   в TestFlight. Dev на симуляторе: `npx tauri ios dev`.
7. Живой смоук тот же, что на Android (открытие системным пикером → правка →
   сохранение): файловые операции идут через те же плагины dialog/fs —
   на iOS это UIDocumentPickerViewController.
