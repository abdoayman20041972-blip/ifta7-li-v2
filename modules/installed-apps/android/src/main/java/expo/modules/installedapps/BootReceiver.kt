package expo.modules.installedapps

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

// يعيد فتح الدائرة العائمة بعد إقلاع الجهاز لو كانت مفعّلة قبل الإيقاف.
// يقرأ الحالة من Prefs (bubble_enabled) — تُكتب عند startBubble/stopBubble.
//
// ⚠️ شرط أساسي على realme UI 2.0: تفعيل «بدء التشغيل التلقائي / Autostart»
// لهذا التطبيق من: الإعدادات ← إدارة البطارية ← بدء التشغيل التلقائي.
// بدونه لن يصل بث BOOT_COMPLETED للتطبيق أبدًا مهما كتبنا في الكود.
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    // QUICKBOOT_POWERON: بث إضافي تصدره أجهزة OPPO/realme عند بعض الإقلاعات
    if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") return
    if (!Prefs.bubbleEnabled(context)) return
    try {
      val i = Intent(context, BubbleService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(i)
      } else {
        context.startService(i)
      }
    } catch (e: Exception) {
      // إن فشل بدء الخدمة الأمامية بعد الإقلاع فلا شيء نفعله هنا؛
      // المستخدم يفتحها من التطبيق كالمعتاد.
    }
  }
}
