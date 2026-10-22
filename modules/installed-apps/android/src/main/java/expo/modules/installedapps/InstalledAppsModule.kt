package expo.modules.installedapps

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InstalledAppsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("InstalledApps")

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

    // يفتح تطبيقاً بحسب اسم الحزمة. يرجع true لو نجح، false لو غير مثبت.
    Function("launchApp") { packageName: String ->
      val intent = context.packageManager.getLaunchIntentForPackage(packageName)
      if (intent == null) {
        false
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
      }
    }
  }
}
