package app.novagrid.mobile

import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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
  }
}
