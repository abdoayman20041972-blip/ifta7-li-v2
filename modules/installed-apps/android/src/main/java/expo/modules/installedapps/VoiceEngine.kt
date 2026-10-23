package expo.modules.installedapps

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.SpeechRecognizer
import android.widget.Toast
import kotlin.math.max

// محرك البصمة الصوتية (الطبقة أ في معمارية «تسجيلة واحدة، ثلاث طبقات»).
//
// التسجيل: 3 عينات متتالية لنفس الكلمة (مع Toasts إرشادية) → 3 قوالب MFCC.
// المطابقة: تسجيلة ذاتية واحدة (MicRecorder + VAD) → MFCC → DTW على كل البصمات
// → إن نزلت أفضل مسافة تحت العتبة: نصُدر العبارة المسجّلة كأنها نتيجة تعرف كلام،
// فتعمل داخل خط الأنابيب الموجود (understandBest ← فتح التطبيق ← عدّاد الاستخدام).
// إن لم تثق: نُصدر حدث onVoiceNoMatch وتتولى جوجل (الطبقة الاحتياطية) من JS.
//
// بلا إنترنت، بلا موديلات، بلا أي مكتبات — كوتلن صِرف.
object VoiceEngine {
  // عتبة القبول على مسافة DTW المعيارية [0..2]. مُضبوطة تحفظيًا:
  // نفضّل الرفض الخاطئ (يتولى جوجل) على القبول الخاطئ (يفتح تطبيقًا غلط).
  // قابلة للضبط من الإعدادات في مرحلة الصقل (setVoiceThreshold).
  const val DEFAULT_THRESHOLD = 0.72f
  private const val KEY_THRESHOLD = "vp_threshold"

  // أقل عدد إطارات يعتبر كلمة حقيقية (25 إطارًا ≈ 0.35 ثانية)
  private const val MIN_FRAMES = 25
  // أعلى مسافة متسقة بين عينات التسجيل الثلاث (إلا فالنطق متذبذب — أعد المحاولة)
  private const val CONSISTENCY_MAX = 0.95f

  @Volatile
  private var busy = false

  private val main = Handler(Looper.getMainLooper())

  fun hasTemplates(ctx: Context): Boolean = VoiceStore.count(ctx.applicationContext) > 0

  fun threshold(ctx: Context): Float =
    ctx.applicationContext.getSharedPreferences("ifta7li_prefs", Context.MODE_PRIVATE)
      .getFloat(KEY_THRESHOLD, DEFAULT_THRESHOLD)

  fun setThreshold(ctx: Context, v: Float) {
    val t = v.coerceIn(0.4f, 1.2f)
    ctx.applicationContext.getSharedPreferences("ifta7li_prefs", Context.MODE_PRIVATE)
      .edit().putFloat(KEY_THRESHOLD, t).apply()
  }

  /**
   * تسجيل بصمة لتطبيق (3 عينات). يعمل على خيط AsyncFunction — حاجب مقصود.
   * يعيد: ok | busy | noisy | too_short | inconsistent | failed
   */
  fun enroll(ctx: Context, pkg: String, phrase: String): String {
    val appCtx = ctx.applicationContext
    if (busy) return "busy"
    busy = true
    try {
      SpeechEngine.release() // قاعدة: لا ميكروفونين أبدًا
      val templates = ArrayList<Array<FloatArray>>(3)
      for (i in 1..3) {
        main.post { Toast.makeText(appCtx, "قل: «$phrase» ($i من 3)...", Toast.LENGTH_SHORT).show() }
        Thread.sleep(1000) // مهلة ليقرأ الرسالة ويستعد
        val pcm = MicRecorder().recordUtterance() ?: return "noisy"
        val frames = Mfcc.extract(pcm)
        if (frames.size < MIN_FRAMES) return "too_short"
        templates.add(frames)
        if (i < 3) Thread.sleep(700)
      }
      // فحص الاتساق: لو العينات الثلاث مختلفة جوهًا فالمستخدم نطق أشياء مختلفة
      val d01 = Dtw.distance(templates[0], templates[1])
      val d02 = Dtw.distance(templates[0], templates[2])
      val d12 = Dtw.distance(templates[1], templates[2])
      if (max(d01, max(d02, d12)) > CONSISTENCY_MAX) return "inconsistent"
      return if (VoiceStore.save(appCtx, pkg, phrase, templates)) "ok" else "failed"
    } catch (e: Exception) {
      return "failed"
    } finally {
      busy = false
    }
  }

  /**
   * مطابقة فورية من الدائرة العائمة: تسجيلة واحدة ثم DTW.
   * يطلق خيطه الخاص (يُستدعى من الخيط الرئيسي في الخدمة) ويعيد فورًا.
   * stateCb: تحديث واجهة الدائرة + إصدار الحالات لـ JS.
   */
  fun matchOnce(
    ctx: Context,
    source: String,
    stateCb: (String) -> Unit,
    toastCb: (String) -> Unit
  ) {
    val appCtx = ctx.applicationContext
    if (busy) {
      toastCb("مشتغل حاليًا، لحظة")
      return
    }
    busy = true
    Thread {
      try {
        SpeechEngine.release() // قاعدة: لا ميكروفونين أبدًا
        stateCb("listening")
        val pcm = MicRecorder().recordUtterance()
        if (pcm == null) {
          stateCb("idle")
          toastCb("ما سمعتش صوت واضح، حاول تاني")
          InstalledAppsModule.emitError(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, source)
          return@Thread
        }
        stateCb("hearing")
        stateCb("processing")
        val frames = Mfcc.extract(pcm)
        if (frames.size < MIN_FRAMES) {
          stateCb("idle")
          toastCb("الكلام قصير أوي، حاول تاني")
          InstalledAppsModule.emitError(SpeechRecognizer.ERROR_NO_MATCH, source)
          return@Thread
        }
        var bestPhrase: String? = null
        var bestD = Float.MAX_VALUE
        for (e in VoiceStore.list(appCtx)) {
          val ts = VoiceStore.load(appCtx, e) ?: continue
          val d = Dtw.bestMatch(frames, ts)
          if (d < bestD) {
            bestD = d
            bestPhrase = e.phrase
          }
        }
        stateCb("idle")
        val th = threshold(appCtx)
        if (bestPhrase != null && bestD <= th) {
          if (!InstalledAppsModule.emitResult(listOf(bestPhrase), source)) {
            toastCb("افتح تطبيق \"افتح لي\" مرة واحدة ثم حاول تاني")
          }
        } else {
          // غير واثق → الطبقة الاحتياطية (جوجل) تتولى من JS عبر حدث onVoiceNoMatch
          if (!InstalledAppsModule.emitVoiceNoMatch(source, bestD, th)) {
            toastCb("افتح تطبيق \"افتح لي\" مرة واحدة ثم حاول تاني")
          }
        }
      } catch (e: Exception) {
        stateCb("idle")
        toastCb("حصلت مشكلة في البصمة الصوتية")
      } finally {
        busy = false
      }
    }.start()
  }

  /**
   * تشخيص البصمة (المرحلة 6 — الصقل): تسجيلة واحدة → DTW على كل البصمات
   * → يعيد الأرقام الخام **بلا تنفيذ أي شيء**، ليعاين المستخدم المسافة الحقيقية
   * ويقرر ضبط العتبة من شاشة «ضبط البصمة».
   * يعيد JSON: { ok, error?, count, bestPhrase, bestD, threshold, matched }
   * يعمل حاجبًا على خيط AsyncFunction (مثل enroll).
   */
  fun diagnose(ctx: Context): String {
    val appCtx = ctx.applicationContext
    if (busy) return "{\"ok\":false,\"error\":\"busy\"}"
    busy = true
    try {
      SpeechEngine.release() // قاعدة: لا ميكروفونين أبدًا
      val pcm = MicRecorder().recordUtterance()
        ?: return "{\"ok\":false,\"error\":\"noisy\"}"
      val frames = Mfcc.extract(pcm)
      if (frames.size < MIN_FRAMES) return "{\"ok\":false,\"error\":\"too_short\"}"
      val entries = VoiceStore.list(appCtx)
      if (entries.isEmpty()) return "{\"ok\":false,\"error\":\"empty\"}"
      var bestPhrase: String? = null
      var bestD = Float.MAX_VALUE
      for (e in entries) {
        val ts = VoiceStore.load(appCtx, e) ?: continue
        val d = Dtw.bestMatch(frames, ts)
        if (d < bestD) {
          bestD = d
          bestPhrase = e.phrase
        }
      }
      val th = threshold(appCtx)
      val matched = bestPhrase != null && bestD <= th
      return org.json.JSONObject()
        .put("ok", true)
        .put("count", entries.size)
        .put("bestPhrase", bestPhrase ?: "")
        .put("bestD", bestD.toDouble())
        .put("threshold", th.toDouble())
        .put("matched", matched)
        .toString()
    } catch (e: Exception) {
      return "{\"ok\":false,\"error\":\"failed\"}"
    } finally {
      busy = false
    }
  }
}
