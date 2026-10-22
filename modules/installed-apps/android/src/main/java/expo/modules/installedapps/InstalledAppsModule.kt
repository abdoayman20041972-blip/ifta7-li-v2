package expo.modules.installedapps

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
  private var engine: SpeechEngine? = null

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
  }

  override fun definition() = ModuleDefinition {
    Name("InstalledApps")
    Events("onSpeechResult", "onSpeechState", "onSpeechError")

    OnCreate { instance = this@InstalledAppsModule }
    OnDestroy {
      instance = null
      main.post { engine?.release(); engine = null }
    }

    // ===== الصوت داخل التطبيق =====
    Function("isSpeechAvailable") { SpeechEngine.isAvailable(context) }

    Function("startListening") {
      val appCtx = context.applicationContext
      main.post {
        engine?.release()
        val e = SpeechEngine(
          appCtx,
          { state -> emitState(state, "app") },
          { list -> emitResult(list, "app") },
          { code -> emitError(code, "app") }
        )
        engine = e
        e.start()
      }
      true
    }

    Function("stopListening") {
      main.post {
        engine?.release()
        engine = null
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
          "ok"
        } catch (e: Exception) {
          "failed"
        }
      }
    }

    Function("stopBubble") {
      context.stopService(Intent(context, BubbleService::class.java))
      true
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
          "ok"
        } catch (e: Exception) {
          "failed"
        }
      }
    }
  }
}
