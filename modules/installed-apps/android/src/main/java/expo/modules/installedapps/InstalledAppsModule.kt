package expo.modules.installedapps

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InstalledAppsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val main = Handler(Looper.getMainLooper())

  companion object {
    @Volatile private var instance: InstalledAppsModule? = null

    private fun send(name: String, body: Bundle): Boolean {
      val m = instance ?: return false
      return try {
        m.sendEvent(name, body)
        true
      } catch (e: Exception) {
        false
      }
    }

    fun emitState(state: String, source: String): Boolean =
      send("onSpeechState", Bundle().apply { putString("state", state); putString("source", source) })

    fun emitResult(list: List<String>, source: String): Boolean =
      send("onSpeechResult", Bundle().apply {
        putString("text", list.firstOrNull() ?: "")
        putString("alternatives", list.joinToString("|"))
        putString("source", source)
      })

    fun emitError(code: Int, source: String): Boolean =
      send("onSpeechError", Bundle().apply {
        putInt("code", code)
        putString("message", speechErrorMessage(code))
        putString("source", source)
      })

    // البصمة لم تثق بنتيجة — تتولى جوجل (الطبقة الاحتياطية) من JS
    fun emitVoiceNoMatch(source: String, distance: Float, threshold: Float): Boolean =
      send("onVoiceNoMatch", Bundle().apply {
        putString("source", source)
        putFloat("distance", distance)
        putFloat("threshold", threshold)
      })
  }

  override fun definition() = ModuleDefinition {
    Name("InstalledApps")
    Events("onSpeechResult", "onSpeechState", "onSpeechError", "onVoiceNoMatch")

    OnCreate { instance = this@InstalledAppsModule }
    OnDestroy {
      instance = null
      main.post { SpeechEngine.release() }
    }

    // ===== الصوت داخل التطبيق =====
    // نستخدم المحرك المفرد SpeechEngine (مشارك مع الدائرة) — إنشاء محركين
    // معًا هو سبب ERROR_RECOGNIZER_BUSY الذي كان باجًا فعليًا.
    Function("isSpeechAvailable") { SpeechEngine.isAvailable(context) }

    Function("startListening") {
      val appCtx = context.applicationContext
      main.post {
        SpeechEngine.start(
          appCtx,
          { state -> emitState(state, "app") },
          { list -> emitResult(list, "app") },
          { code -> emitError(code, "app") }
        )
      }
      true
    }

    Function("stopListening") {
      main.post {
        SpeechEngine.release()
        emitState("idle", "app")
      }
      true
    }

    Function("showToast") { text: String ->
      val appCtx = context.applicationContext
      main.post { Toast.makeText(appCtx, text, Toast.LENGTH_SHORT).show() }
      true
    }

    // ===== الدائرة العائمة =====
    Function("canDrawOverlays") { Settings.canDrawOverlays(context) }

    Function("openOverlaySettings") {
      val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
      true
    }

    Function("isBubbleRunning") { BubbleService.running }

    // يرجع: ok | no_overlay_permission | no_mic_permission | failed
    Function("startBubble") {
      val ctx = context
      when {
        !Settings.canDrawOverlays(ctx) -> "no_overlay_permission"
        ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED -> "no_mic_permission"
        else -> try {
          val i = Intent(ctx, BubbleService::class.java)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
          // نعلّم أنها مفعّلة ليعيد BootReceiver فتحها بعد إقلاع الجهاز
          Prefs.setBubbleEnabled(ctx.applicationContext, true)
          "ok"
        } catch (e: Exception) {
          "failed"
        }
      }
    }

    // نوقفها عبر نية ACTION_STOP حتى تميز الخدمة الإيقاف البشري عن قتل النظام
    // فلا تُعيد جدولة الإنذار الاحتياطي في حالة الإيقاف المتعمد.
    Function("stopBubble") {
      Prefs.setBubbleEnabled(context.applicationContext, false)
      context.startService(Intent(context, BubbleService::class.java).setAction(BubbleService.ACTION_STOP))
      true
    }

    // ===== الجسر إلى الكوتلن (أساس المرحلة 1) =====
    // AsyncStorage غير مرئي للكوتلن — يكتب JS الأوامر هنا بعد كل تغيير
    // حتى تقرأها الدائرة العائمة بلا انتظار أن يكون التطبيق حيًا.
    AsyncFunction("saveCommands") { json: String ->
      Prefs.saveCommands(context.applicationContext, json)
      true
    }

    AsyncFunction("getCommands") { Prefs.commandsJson(context.applicationContext) }

    // يُستدعى تلقائيًا من launchApp عند النجاح — متاح أيضًا لواحتاج JS له.
    AsyncFunction("recordUse") { pkg: String ->
      Prefs.recordUse(context.applicationContext, pkg)
      true
    }

    // نص JSON: { counts: { pkg: n }, recent: [pkg, ...] } — يدمجه JS مع AsyncStorage عند البدء.
    AsyncFunction("getUsage") { Prefs.usageJson(context.applicationContext) }

    // ===== البصمة الصوتية (المرحلة 2) =====
    // تسجيل بصمة لتطبيق: 3 عينات لنفس الاسم. يعمل على خيط AsyncFunction (حاجب مقصود).
    // يعيد: ok | busy | noisy | too_short | inconsistent | failed
    AsyncFunction("enrollVoice") { pkg: String, phrase: String ->
      VoiceEngine.enroll(context.applicationContext, pkg, phrase)
    }

    // نص JSON: [{ id, pkg, phrase }]
    AsyncFunction("getVoiceprints") {
      val arr = org.json.JSONArray()
      for (e in VoiceStore.list(context.applicationContext)) {
        arr.put(org.json.JSONObject().put("id", e.id).put("pkg", e.pkg).put("phrase", e.phrase))
      }
      arr.toString()
    }

    AsyncFunction("deleteVoiceprint") { id: String ->
      VoiceStore.delete(context.applicationContext, id)
    }

    // مطابقة فورية (تُستخدم من JS لواحد يجرّب من داخل التطبيق). الدائرة تستدعيها مباشرة.
    // يعيد: started | busy
    Function("matchVoice") { source: String ->
      val appCtx = context.applicationContext
      VoiceEngine.matchOnce(
        appCtx,
        source,
        { state -> main.post { emitState(state, source) } },
        { msg -> main.post { Toast.makeText(appCtx, msg, Toast.LENGTH_SHORT).show() } }
      )
    }

    // عتبة القبول (مرحلة الصقل): 0.4..1.2
    Function("setVoiceThreshold") { v: Double ->
      VoiceEngine.setThreshold(context.applicationContext, v.toFloat())
      true
    }

    Function("getVoiceThreshold") { VoiceEngine.threshold(context.applicationContext).toDouble() }

    // تشخيص البصمة (مرحلة 6): تسجيلة واحدة → أرقام خام بلا تنفيذ.
    // يعيد JSON: { ok, error?, count, bestPhrase, bestD, threshold, matched }
    AsyncFunction("diagnoseVoice") { VoiceEngine.diagnose(context.applicationContext) }

    // ===== أوامر الجهاز (المرحلة 4) =====
    // الكشاف عبر CameraManager.setTorchMode — لا يحتاج إذن CAMERA أبدًا.
    // يرجع: "ok" | "no_flash" الجهاز بلا فلاش | "failed"
    Function("setFlashlight") { enabled: Boolean ->
      val ctx = context.applicationContext
      try {
        val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val flashId = cm.cameraIdList.firstOrNull { id ->
          cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
        }
        if (flashId == null) {
          "no_flash"
        } else {
          cm.setTorchMode(flashId, enabled)
          "ok"
        }
      } catch (e: Exception) {
        "failed"
      }
    }

    // ===== إعدادات الجهاز (المرحلة 5) =====
    // على أندرويد 11 (API 30) التبديل البرمجي للواي فاي/البلوتوث/الطيران مُنع رسميًا
    // (منذ API 29) — البديل: لوحة Settings.Panel للاتصال + شاشات الإعدادات المعنية.
    // يرجع: "ok" | "failed"
    Function("openWifiPanel") {
      val ctx = context.applicationContext
      try {
        val i = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY) // واي فاي + بيانات في لوحة عائمة
        } else {
          Intent(Settings.ACTION_WIFI_SETTINGS)
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        "ok"
      } catch (e: Exception) {
        "failed"
      }
    }

    Function("openBluetoothSettings") {
      val ctx = context.applicationContext
      try {
        val i = Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        "ok"
      } catch (e: Exception) {
        "failed"
      }
    }

    Function("openAirplaneSettings") {
      val ctx = context.applicationContext
      try {
        val i = Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        "ok"
      } catch (e: Exception) {
        "failed"
      }
    }

    // قائمة التطبيقات التي لها أيقونة تشغيل: [{ name, pkg }]
    AsyncFunction("getLaunchableApps") {
      val pm = context.packageManager
      val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcherIntent, 0)
        .map { info ->
          mapOf(
            "name" to info.loadLabel(pm).toString(),
            "pkg" to info.activityInfo.packageName
          )
        }
        .filter { it["pkg"] != context.packageName } // لا نعرض التطبيق نفسه
        .distinctBy { it["pkg"] }
        .sortedBy { it["name"]!!.lowercase() }
    }

    // يفتح تطبيقاً بحسب اسم الحزمة. يرجع: "ok" نجح | "not_installed" غير مثبت | "failed" فشل التشغيل لسبب آخر.
    Function("launchApp") { packageName: String ->
      val intent = context.packageManager.getLaunchIntentForPackage(packageName)
      if (intent == null) {
        "not_installed"
      } else {
        try {
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
          // نكتب الاستخدام في المرآة (Prefs) فورًا: هي مصدر قائمة «الأكثر استخدامًا»
          // في ضغطة الدائرة الطويل، حتى لو لم يعد JS حيًا وقتها.
          Prefs.recordUse(context.applicationContext, packageName)
          "ok"
        } catch (e: Exception) {
          "failed"
        }
      }
    }
  }
}
