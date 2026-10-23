package expo.modules.installedapps

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs

// دائرة عائمة فوق التطبيقات: اضغطها، قل الأمر، فيُنفَّذ.
// ضغطة طويلة (بدون سحب) = قائمة أكثر 4 تطبيقات استخدامًا.
//
// حزمة البقاء على realme UI 2.0 (أخطر تهديد للدائرة هو قتل النظام لها):
//   1) START_STICKY: النظام يعيد تشغيل الخدمة لو قتلها.
//   2) stopWithTask="false" (في الـ Manifest): سحب التطبيق من المهام لا يوقفها.
//   3) onTaskRemoved + AlarmManager: إن قتلها realme رغم ذلك يوجد إنذار يعيدها بعد ثانية.
//   4) حفظ مكان الدائرة في Prefs: تعود لنفس المكان بعد أي إعادة تشغيل.
//   5) BootReceiver: يعيدها بعد إقلاع الجهاز لو كانت مفعّلة (شرطه إذن Autostart من realme).
@Suppress("DEPRECATION")
class BubbleService : Service() {
  companion object {
    @Volatile var running = false
    private const val CHANNEL_ID = "ifta7li_bubble"
    private const val NOTIF_ID = 7001
    const val ACTION_STOP = "expo.modules.installedapps.STOP_BUBBLE"
    private const val RESTART_REQUEST = 1001
    private const val RESTART_DELAY_MS = 1000L
    private const val LONG_PRESS_MS = 450L
    private const val QUICK_PANEL_TIMEOUT_MS = 6000L
    private const val RECENT_COUNT = 4
    private const val COLOR_IDLE = "#0F766E"
    private const val COLOR_LISTENING = "#DC2626"
  }

  private var windowManager: WindowManager? = null
  private var bubble: TextView? = null
  private var target: TextView? = null
  private var quickPanel: LinearLayout? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private var userStopped = false
  // المرحلة 3: إعادة تلقائية واحدة للجولة الجوجلية من الدائرة (عندما لا توجد بصمات)
  // عند «ما فهمتش/ما سمعتش» — نفس منطق التطبيق في onError، وبحد أقصى مرة واحدة.
  private var googleRetryUsed = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      userStopped = true
      stopSelf()
      return START_NOT_STICKY
    }
    // إعادة التشغيل (START_STICKY أو الإنذار الاحتياطي) قد توصلنا بنية بلا واجهة — نبنيها إن غابت.
    // بناء الواجهة ماصّ (idempotent): لو موجودة فلا نضيف دائرة ثانية فوقها.
    if (bubble == null) {
      try {
        addBubble()
      } catch (e: Exception) {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    return START_STICKY
  }

  override fun onCreate() {
    super.onCreate()
    userStopped = false
    startAsForeground()
    running = true
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    // مع stopWithTask="false" الخدمة تعيش بعد سحب التطبيق من المهام، لكن realme UI
    // قد يقتلها رغم ذلك — هذا الإنذار احتياط يعيد تشغيلها بعد ثانية واحدة.
    if (userStopped) return
    scheduleRestart()
  }

  override fun onDestroy() {
    running = false
    SpeechEngine.release()
    if (userStopped) cancelRestart()
    bubble?.let {
      try { windowManager?.removeView(it) } catch (e: Exception) {}
    }
    bubble = null
    target?.let {
      try { windowManager?.removeView(it) } catch (e: Exception) {}
    }
    target = null
    hideQuickApps()
    super.onDestroy()
  }

  // ===== الإنذار الاحتياطي لإعادة التشغيل =====
  private fun restartPendingIntent(): PendingIntent = PendingIntent.getService(
    this, RESTART_REQUEST,
    Intent(this, BubbleService::class.java),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
  )

  private fun scheduleRestart() {
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.setExactAndAllowWhileIdle(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        SystemClock.elapsedRealtime() + RESTART_DELAY_MS,
        restartPendingIntent()
      )
    } catch (e: Exception) {}
  }

  private fun cancelRestart() {
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.cancel(restartPendingIntent())
    } catch (e: Exception) {}
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

  private fun toast(msg: String) {
    Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
  }

  private fun startAsForeground() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "الدائرة العائمة", NotificationManager.IMPORTANCE_LOW))
    }
    val stop = PendingIntent.getService(
      this, 0,
      Intent(this, BubbleService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
    val notification = builder
      .setContentTitle("افتح لي")
      .setContentText("اضغط الدائرة وقل اسم التطبيق — ضغطة طويلة تُظهر أكثر تطبيقات استخدامك")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(0, "إيقاف", stop).build())
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  private fun circle(color: String) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(Color.parseColor(color))
  }

  private fun roundRect(color: String) = GradientDrawable().apply {
    shape = GradientDrawable.RECTANGLE
    setColor(Color.parseColor(color))
    cornerRadius = dp(14).toFloat()
  }

  private fun look(active: Boolean) {
    bubble?.background = circle(if (active) COLOR_LISTENING else COLOR_IDLE)
  }

  private fun overlayType(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE

  private fun targetSize() = dp(64)
  private fun targetBottom() = dp(56)
  private fun screenW() = resources.displayMetrics.widthPixels
  private fun screenH() = resources.displayMetrics.heightPixels
  private fun targetCenterX() = screenW() / 2
  private fun targetCenterY() = screenH() - targetBottom() - targetSize() / 2

  // دائرة الحذف (✕) أسفل الشاشة: تظهر فقط أثناء سحب الدائرة العائمة، مثل ماسنجر.
  // تُضاف قبل الدائرة العائمة حتى تبقى الدائرة العائمة فوقها.
  private fun addTarget(wm: WindowManager) {
    val t = TextView(this).apply {
      text = "✕"
      textSize = 26f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      background = circle("#CC1F2937")
      visibility = View.GONE
    }
    val lp = WindowManager.LayoutParams(
      targetSize(), targetSize(), overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
      y = targetBottom()
    }
    try {
      wm.addView(t, lp)
      target = t
    } catch (e: Exception) {}
  }

  private fun showTarget(show: Boolean) {
    target?.visibility = if (show) View.VISIBLE else View.GONE
    if (!show) highlightTarget(false)
  }

  private fun highlightTarget(on: Boolean) {
    target?.let {
      it.background = circle(if (on) "#DC2626" else "#CC1F2937")
      val k = if (on) 1.3f else 1f
      it.scaleX = k
      it.scaleY = k
    }
  }

  private fun addBubble() {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm
    val size = dp(56)
    val view = TextView(this).apply {
      text = "🎤"
      textSize = 24f
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      background = circle(COLOR_IDLE)
      elevation = dp(6).toFloat()
    }
    addTarget(wm)
    val lp = WindowManager.LayoutParams(
      size, size, overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      // نستعيد آخر مكان للمستخدم (داخل حدود الشاشة الحالية)، وإلا فالمكان الافتراضي
      val sx = Prefs.bubbleX(this@BubbleService)
      val sy = Prefs.bubbleY(this@BubbleService)
      if (sx != Int.MIN_VALUE && sy != Int.MIN_VALUE) {
        x = sx.coerceIn(0, (screenW() - size).coerceAtLeast(0))
        y = sy.coerceIn(0, (screenH() - size).coerceAtLeast(0))
      } else {
        x = dp(12)
        y = dp(240)
      }
    }

    var startX = 0
    var startY = 0
    var touchX = 0f
    var touchY = 0f
    var moved = false
    var near = false
    var downAt = 0L
    view.setOnTouchListener { v, e ->
      when (e.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = lp.x; startY = lp.y; touchX = e.rawX; touchY = e.rawY; moved = false; near = false
          downAt = SystemClock.uptimeMillis()
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - touchX
          val dy = e.rawY - touchY
          if (abs(dx) > dp(8) || abs(dy) > dp(8)) moved = true
          if (moved) {
            showTarget(true)
            lp.x = startX + dx.toInt()
            lp.y = startY + dy.toInt()
            val cx = lp.x + size / 2
            val cy = lp.y + size / 2
            val ddx = (cx - targetCenterX()).toDouble()
            val ddy = (cy - targetCenterY()).toDouble()
            val isNear = Math.sqrt(ddx * ddx + ddy * ddy) < dp(80)
            if (isNear != near) {
              near = isNear
              highlightTarget(near)
            }
            if (near) {
              // الدائرة تنجذب إلى ✕ لتوضيح أن الإفلات سيحذفها
              lp.x = targetCenterX() - size / 2
              lp.y = targetCenterY() - size / 2
            }
            wm.updateViewLayout(v, lp)
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          val shouldClose = moved && near
          showTarget(false)
          if (shouldClose) {
            stopSelf()
          } else if (moved) {
            // تلتصق بأقرب حافة جانبية بعد الإفلات، ثم نحفظ المكان ليعود إليه بعد أي إعادة تشغيل
            val goRight = lp.x + size / 2 > screenW() / 2
            lp.x = if (goRight) screenW() - size - dp(8) else dp(8)
            try { wm.updateViewLayout(v, lp) } catch (ex: Exception) {}
            Prefs.saveBubblePos(applicationContext, lp.x, lp.y)
          } else if (SystemClock.uptimeMillis() - downAt > LONG_PRESS_MS) {
            showQuickApps()
          } else {
            onBubbleTap()
          }
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          showTarget(false)
          true
        }
        else -> false
      }
    }
    wm.addView(view, lp)
    bubble = view
  }

  // ===== ضغطة طويلة: أكثر التطبيقات استخدامًا =====
  // يقرأ من مرآة Prefs التي يغذيها launchApp عند كل فتح ناجح — بلا PACKAGE_USAGE_STATS.
  private fun showQuickApps() {
    if (quickPanel != null) {
      hideQuickApps()
      return
    }
    val pkgs = Prefs.topUsed(applicationContext, RECENT_COUNT)
    val pm = packageManager
    val rows = ArrayList<TextView>()
    for (pkg in pkgs) {
      val label = try {
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
      } catch (e: Exception) {
        continue // التطبيق ربما أُزيل
      }
      val row = TextView(this).apply {
        text = label
        textSize = 15f
        setTextColor(Color.WHITE)
        setPadding(dp(14), dp(10), dp(14), dp(10))
        // سطر فاصل رقيق بين العناصر
        setCompoundDrawablesWithIntrinsicBounds(0, 0, 0, 0)
        setOnClickListener {
          hideQuickApps()
          try {
            val i = pm.getLaunchIntentForPackage(pkg)
            if (i != null) {
              i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
              startActivity(i)
              // فتح من الدائرة نفسها يُحسب أيضًا في عدّاد الاستخدام
              Prefs.recordUse(applicationContext, pkg)
            }
          } catch (e: Exception) {}
        }
      }
      rows.add(row)
    }
    if (rows.isEmpty()) {
      toast("افتِح تطبيقات من «افتح لي» الأول وهايتعلم أكثر اللي بتستخدمه")
      return
    }
    val col = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = roundRect("#F21F2937")
      elevation = dp(8).toFloat()
      // لمس خارج اللوحة يغلقها
      setOnTouchListener { _, e ->
        if (e.action == MotionEvent.ACTION_OUTSIDE) {
          hideQuickApps()
          true
        } else false
      }
    }
    rows.forEachIndexed { idx, row ->
      if (idx > 0) {
        val sep = View(this).apply { setBackgroundColor(0x33FFFFFF); minimumHeight = dp(1) }
        col.addView(sep, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))
      }
      col.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }
    val plp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType(),
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      // نفتح اللوحة بجوار الدائرة، مقيّدة داخل الشاشة
      val b = bubble
      val blp = b?.layoutParams as? WindowManager.LayoutParams
      if (blp != null) {
        x = (blp.x + dp(56) + dp(8)).coerceIn(0, (screenW() - dp(200)).coerceAtLeast(0))
        y = blp.y.coerceIn(0, (screenH() - dp(220)).coerceAtLeast(0))
      } else {
        x = dp(80); y = dp(240)
      }
    }
    try {
      windowManager?.addView(col, plp)
      quickPanel = col
      // إغلاق تلقائي احتياطي لو بقي مفتوحًا
      mainHandler.postDelayed({ hideQuickApps() }, QUICK_PANEL_TIMEOUT_MS)
    } catch (e: Exception) {}
  }

  private fun hideQuickApps() {
    mainHandler.removeCallbacksAndMessages(null)
    quickPanel?.let {
      try { windowManager?.removeView(it) } catch (e: Exception) {}
    }
    quickPanel = null
  }

  private fun onBubbleTap() {
    if (SpeechEngine.listening) {
      SpeechEngine.release()
      look(false)
      return
    }
    look(true)
    if (VoiceEngine.hasTemplates(this)) {
      // الطبقة أ: البصمة الصوتية أوفلاين أولًا — لو لم تثق تُصدر onVoiceNoMatch
      // ويتولى JS جولة جوجل (الطبقة الاحتياطية) بلا تسجيل ذاتي متزامن.
      googleRetryUsed = false
      VoiceEngine.matchOnce(
        applicationContext,
        "bubble",
        { state ->
          InstalledAppsModule.emitState(state, "bubble")
          look(state == "listening" || state == "hearing" || state == "processing")
        },
        { msg -> toast(msg) }
      )
    } else {
      startGoogleRound(retry = false)
    }
  }

  // الجولة الجوجلية من الدائرة (عندما لا توجد بصمات) مع إعادة تلقائية واحدة.
  // ملاحظة: تُستدعى حصرًا من الخيط الرئيسي — شرط SpeechRecognizer.
  private fun startGoogleRound(retry: Boolean) {
    if (retry) {
      toast("قول الأمر تاني...")
      look(true)
    }
    SpeechEngine.start(
      applicationContext,
      { state ->
        InstalledAppsModule.emitState(state, "bubble")
        look(state == "listening" || state == "hearing")
      },
      { list ->
        look(false)
        googleRetryUsed = false // نجاح — السلسلة الجديدة تبدأ نظيفة
        if (!InstalledAppsModule.emitResult(list, "bubble")) {
          toast("افتح تطبيق \"افتح لي\" مرة واحدة ثم حاول تاني")
        }
      },
      { code ->
        look(false)
        // إعادة تلقائية واحدة فقط عند «ما فهمتش/ما سمعتش»؛ الشبكة والأذونات لا فائدة من إعادتها.
        val retryable = code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        if (retryable && !googleRetryUsed) {
          googleRetryUsed = true
          mainHandler.postDelayed({ startGoogleRound(retry = true) }, 700)
        } else {
          googleRetryUsed = false
          toast(speechErrorMessage(code))
        }
      }
    )
  }
}
