package app.novagrid.mobile

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import org.json.JSONObject

class MainActivity : TauriActivity() {
  companion object {
    // novagrid-068: имя файла из системного «Открыть с помощью» (ACTION_VIEW);
    // байты лежат в cacheDir/nv-open.tmp, фронтенд забирает их одноразово
    // через мост __NovaGridAndroid.takePending() + Rust-команду
    // mobile_read_open_intent (desktop/src/lib.rs)
    @Volatile
    var pendingName: String? = null
  }

  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // novagrid-064: edge-to-edge (принудителен с targetSdk 35+, enableEdgeToEdge
    // включает его и на старых Android) рисовал WebView на весь экран — контент
    // заходил под статус-бар (часы, настройки) и навигационную панель. Сдвигаем
    // контейнер контента (android.R.id.content, в него wry кладёт WebView) на
    // отступы системных панелей: окно лежит строго между ними, полосы сверху/снизу
    // закрывает фон окна — цвет темы приложения (themes.xml values/values-night).
    val content = window.decorView.findViewById<ViewGroup>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      windowInsets
    }

    // холодный старт по ассоциации (launchMode=singleTask); повторное создание
    // активити (поворот с клавиатурой и т.п.) интент не перезабирает — иначе
    // файл открывался бы заново поверх текущей книги
    if (savedInstanceState == null) handleViewIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleViewIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    // мост для фронтенда: pull имени открытого файла (байты читает Rust-команда)
    webView.addJavascriptInterface(OpenBridge(), "__NovaGridAndroid")
    notifyOpen()
  }

  /** ACTION_VIEW с content:// URI → байты в cacheDir/nv-open.tmp + имя. */
  private fun handleViewIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_VIEW) return
    val uri: Uri = intent.data ?: return
    Thread {
      try {
        val name = displayName(uri)
        val dest = File(cacheDir, "nv-open.tmp")
        val input = contentResolver.openInputStream(uri) ?: return@Thread
        input.use { src -> dest.outputStream().use { out -> src.copyTo(out) } }
        pendingName = name
        notifyOpen()
      } catch (e: Exception) {
        // не смогли прочитать (провайдер отозвал грант и т.п.) — тихо:
        // фронтенд ничего не ждал, пользователь видит прежний экран
      }
    }.start()
  }

  /** Отображаемое имя: DISPLAY_NAME провайдера, иначе хвост пути. */
  private fun displayName(uri: Uri): String {
    try {
      contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (idx >= 0 && cursor.moveToFirst()) cursor.getString(idx)?.let { return it }
      }
    } catch (e: Exception) {
      // без запроса — fallback по пути
    }
    return uri.lastPathSegment?.substringAfterLast('/') ?: "document"
  }

  /** Толчок во фронтенд (тёплое открытие): окно живёт, страница загружена. */
  private fun notifyOpen() {
    if (pendingName == null) return
    val wv = webView ?: return
    wv.post { wv.evaluateJavascript("window.__nvAndroidOpen && window.__nvAndroidOpen()", null) }
  }

  /** Одноразовый pull: имя ждущего файла (пустая строка — ничего не ждёт). */
  inner class OpenBridge {
    @JavascriptInterface
    fun takePending(): String {
      val name = pendingName ?: return ""
      pendingName = null
      return JSONObject().put("name", name).toString()
    }
  }
}
