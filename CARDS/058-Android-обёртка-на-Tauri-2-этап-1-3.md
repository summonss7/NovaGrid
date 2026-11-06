---
id: novagrid-058
title: Android-обёртка на Tauri 2 — этап 1/3 (зонтичная novagrid-057)
status: done
priority: 2
created: 2026-11-06
updated: 2026-11-06
session: ""
parent: novagrid-057
---
## Задача
Первый этап мобильной версии NovaGrid (зонтичная карточка novagrid-057): обёртка Android
на Tauri 2 из того же крейта desktop/. Решение по варианту и правила проекта — в шапке
новагрид-057.

Конкретика:
- перестроить desktop/ в lib-паттерн Tauri 2 (тонкий main.rs + lib.rs с pub fn run(),
  имя lib-крейта novagrid_lib); всё десктоп-только (rfd-диалоги, нативное меню,
  доп. окна книг, open_external через cmd, OTA-updater) — под #[cfg(desktop)];
  виндовая сборка не должна сломаться;
- `tauri android init` (gen/android коммитится), оверлей tauri.android.conf.json
  (identifier app.novagrid.mobile; csp под мобильный ipc- origin при необходимости);
- фронтенд: на мобильной обёртке isDesktop() === false (window.__TAURI__ там есть —
  withGlobalTauri! признак мобильной обёртки инжектит Rust инициализационным скриптом),
  все вызовы уходят в веб-пути (input[type=file] / downloadBuffer / share);
- иконки Android из знака проекта (как desktop/icons из favicon.svg);
- собрать debug APK в builds/novagrid-<версия>-android-debug/;
- живая проверка на эмуляторе (AVD lecards_test, android-36 x86_64): установка, запуск,
  открытие книги, правка, сохранение; скриншоты в test-results/ (не коммитить артефакты);
- мобильный путь сохранения должен реально работать (FSA в Android WebView нет;
  downloadBuffer a[download] может молчать — тогда фолбэк navigator.share файлом или
  мост в Rust).

## Критерии готовности
- [x] desktop/ в lib-паттерне; десктоп-функциональность за #[cfg(desktop)]; виндовая
      debug-сборка крейта проходит (cargo build --target x86_64-pc-windows-gnu)
- [x] gen/android инициализирован и в репозитории; tauri.android.conf.json применён
- [x] isDesktop() === false на мобильной обёртке; юнит-тест на развилку есть и зелёный
- [x] иконки Android сгенерированы
- [x] debug APK собран в builds/novagrid-<версия>-android-debug/ (+ сам .apk)
- [x] живая проверка на эмуляторе выполнена и описана в журнале (открытие/правка/
      сохранение книги); мобильное сохранение реально сохраняет файл
- [x] npm run test / typecheck / lint — зелёные
- [x] запись в CHANGELOG.md; коммит и push
## Журнал
- 06.11.2026: карточка создана (этап 1/3 цепочки novagrid-057).
- 06.11.2026, 19:22–20:20: этап выполнен.
  - Крейт desktop/ перестроен в lib-паттерн Tauri 2: lib.rs (novagrid_lib) с развилкой
    pub fn run() — cfg(desktop) → модуль desktop_app (вся прежняя логика main.rs: меню,
    rfd-диалоги, доп. окна, close-ask, OTA), cfg(mobile) → тонкий WebView-билдер с
    плагинами tauri-plugin-dialog + tauri-plugin-fs. Виндо-крейты (rfd/reqwest/sha2/
    futures-util/tokio) перенесены в десктоп-секцию target.cfg(...) Cargo.toml,
    плагины — в мобильную. main.rs стал тонким бином; desktop-скрипты собирают
    --bin novagrid (lib как staticlib/cdylib винде не нужен).
  - `tauri android init` → gen/android (коммитится; .gitignore сужен с desktop/gen/
    до desktop/gen/schemas/). Оверлей tauri.android.conf.json: identifier
    app.novagrid.mobile, withGlobalTauri true. Проблема решена: генератор BuildTask.kt
    печёт абсолютный путь CLI — запатчен на переносимые «node» + относительный путь
    ../node_modules/@tauri-apps/cli/tauri.js. Сборка идёт с gnu-тулчейном
    (RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu; дефолтный msvc без линкера) и
    rust-таргетами aarch64/x86_64/armv7/i686-linux-android.
  - Сохранение на Android: веб-пути в WebView не работают (проверено на эмуляторе:
    FSA showSaveFilePicker висит без UI, запись в хэндл открытого файла —
    InvalidStateError грант протухает, a[download] blob игнорируется, navigator.share
    нет) → мобильный мост: плагин dialog (SAF ACTION_CREATE_DOCUMENT) + plugin-fs
    (запись content:// через ContentResolver), capability mobile.json (android+iOS).
    Открытие — прежний input[type=file] (системный пикер от wry).
  - Платформенная развилка фронтенда: признак мобильной обёртки — window.__TAURI__
    .dialog (плагин инжектит только мобильная ветка); isDesktop() теперь требует
    отсутствия .dialog. Новые isTauriMobile/mobilePickSavePath/mobileWriteFile
    (src/io/mobile.ts); ветки в App.tsx: открытие мимо FSA, любое сохранение через
    SAF-диалог (пути/хэндлы на мобильных не персистятся), .nvgridx-снапшот тоже.
  - Попутный фикс веб-бага: в ленте ≤760px файловая группа тулбара не скрывалась
    (поздний app.css .toolbar-group{display:flex} перебивал медиа-правило ui.css)
    и уезжала за край — селектор поднят до .toolbar .toolbar-group.
  - Иконки: scripts/make-android-icons.mjs (favicon.svg → source-1024.png,
    playwright-рендер как у десктоп-иконок) + `tauri icon` → mipmap gen/android.
  - Артефакт: builds/novagrid-1.28.0-android-debug/NovaGrid-1.28.0-android-debug.apk
    (universal debug, x86_64 — под эмулятор; релизный aarch64 — этап 2).
  - Живая проверка на эмуляторе (AVD lecards_test, android-36 x86_64, весь UI через
    adb-тапы + CDP-инспекцию): запуск → мобильный стартовый экран → «Открыть файл…»
    → системный пикер (Downloads) → книга открылась (2 листа, формулы) → правка A2
    через строку формул («Bolt M8x40», клавиатура Android) → Enter зафиксировал →
    ⋯ → «Сохранить как…» → SAF-диалог → SAVE → файл «прайс-058 (1).xlsx» в
    /sdcard/Download, вытащен adb и проверен exceljs: A2 = «Bolt M8x40», формула
    D2=B2*C2 (1250), оба листа на месте. Скриншоты: test-results/novagrid-058/.
