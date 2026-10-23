package expo.modules.installedapps

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// الجسر بين JS وKotlin: مخزن موحد في SharedPreferences يقرؤه ويكتب فيه الطرفان.
//
// لماذا هو أساس المرحلة 1؟ لأن AsyncStorage (حيث تعيش الأوامر في JS) غير مرئي
// للكوتلن إطلاقًا — فالدائرة العائمة كانت لا ترى الأوامر المخصصة أبدًا.
// هنا تعيش:
//   1) الأوامر المخصصة  : [{ pkg, name, aliases: [...] }]  (مرآة يكتبها JS بعد كل تغيير)
//   2) عدّادات الاستخدام : { counts: { pkg: n }, recent: [pkg, ...] }  (بحد 10)
//   3) حالة الدائرة      : هل كانت مفعّلة؟ (يقرأها BootReceiver بعد الإقلاع)
//   4) مكان الدائرة      : آخر إحداثيي سحب (بكسل) لتعود لنفس المكان
object Prefs {
  private const val FILE = "ifta7li_prefs"
  private const val KEY_COMMANDS = "commands_json"
  private const val KEY_USAGE = "usage_json"
  private const val KEY_ENABLED = "bubble_enabled"
  private const val KEY_POS_X = "bubble_x"
  private const val KEY_POS_Y = "bubble_y"
  private const val RECENT_MAX = 10

  private fun p(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  // ===== الأوامر المخصصة (مرآة AsyncStorage) =====
  fun saveCommands(ctx: Context, json: String) {
    p(ctx).edit().putString(KEY_COMMANDS, json).apply()
  }

  fun commandsJson(ctx: Context): String = p(ctx).getString(KEY_COMMANDS, "") ?: ""

  // ===== الاستخدام =====
  fun usageJson(ctx: Context): String = p(ctx).getString(KEY_USAGE, "") ?: ""

  fun saveUsage(ctx: Context, json: String) {
    p(ctx).edit().putString(KEY_USAGE, json).apply()
  }

  // يسجّل فتحًا ناجحًا: يزيد عدّاد التطبيق ويضعه في رأس «آخر ما فتحته».
  // يُستدعى من launchApp عند النجاح ومن ضغط الدائرة الطويل، فلا حاجة ليعيش JS.
  fun recordUse(ctx: Context, pkg: String) {
    if (pkg.isBlank()) return
    val u = try { JSONObject(usageJson(ctx).ifEmpty { "{}" }) } catch (e: Exception) { JSONObject() }
    val counts = u.optJSONObject("counts") ?: JSONObject()
    counts.put(pkg, counts.optInt(pkg, 0) + 1)
    u.put("counts", counts)
    val recent = ArrayList<String>()
    val arr = u.optJSONArray("recent")
    if (arr != null) {
      for (i in 0 until arr.length()) {
        val s = arr.optString(i)
        if (s.isNotEmpty() && s != pkg) recent.add(s)
      }
    }
    recent.add(0, pkg)
    while (recent.size > RECENT_MAX) recent.removeAt(recent.size - 1)
    u.put("recent", JSONArray(recent))
    saveUsage(ctx, u.toString())
  }

  // أكثر n تطبيقات استخدامًا حسب المرآة — يقرأها ضغط الدائرة الطويل (بلا أي أذونات خاصة).
  fun topUsed(ctx: Context, n: Int): List<String> {
    val u = try { JSONObject(usageJson(ctx).ifEmpty { "{}" }) } catch (e: Exception) { JSONObject() }
    val counts = u.optJSONObject("counts") ?: return emptyList()
    return counts.keys().asSequence()
      .filter { counts.optInt(it, 0) > 0 }
      .sortedByDescending { counts.optInt(it, 0) }
      .take(n)
      .toList()
  }

  // ===== حالة الدائرة ومكانها =====
  fun setBubbleEnabled(ctx: Context, on: Boolean) {
    p(ctx).edit().putBoolean(KEY_ENABLED, on).apply()
  }

  fun bubbleEnabled(ctx: Context): Boolean = p(ctx).getBoolean(KEY_ENABLED, false)

  fun saveBubblePos(ctx: Context, x: Int, y: Int) {
    p(ctx).edit().putInt(KEY_POS_X, x).putInt(KEY_POS_Y, y).apply()
  }

  // MIN_VALUE يعني «لا يوجد مكان محفوظ» (أول تشغيل)
  fun bubbleX(ctx: Context): Int = p(ctx).getInt(KEY_POS_X, Int.MIN_VALUE)

  fun bubbleY(ctx: Context): Int = p(ctx).getInt(KEY_POS_Y, Int.MIN_VALUE)
}
