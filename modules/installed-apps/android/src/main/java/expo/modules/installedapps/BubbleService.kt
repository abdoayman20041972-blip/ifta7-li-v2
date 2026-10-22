package expo.modules.installedapps

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
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import kotlin.math.abs

// دائرة عائمة فوق التطبيقات: اضغطها، قل الأمر، فيُنفَّذ.
@Suppress("DEPRECATION")
class BubbleService : Service() {
  companion object {
    @Volatile var running = false
    private const val CHANNEL_ID = "ifta7li_bubble"
    private const val NOTIF_ID = 7001
    private const val ACTION_STOP = "expo.modules.installedapps.STOP_BUBBLE"
    private const val COLOR_IDLE = "#0F766E"
    private const val COLOR_LISTENING = "#DC2626"
  }

  private var windowManager: WindowManager? = null
  private var bubble: TextView? = null
  private var target: TextView? = null
  private var engine: SpeechEngine? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) stopSelf()
    return START_NOT_STICKY
  }

  override fun onCreate() {
    super.onCreate()
    startAsForeground()
    try {
      addBubble()
      running = true
    } catch (e: Exception) {
      stopSelf()
    }
  }

  override fun onDestroy() {
    running = false
    engine?.release()
    engine = null
    bubble?.let {
      try { windowManager?.removeView(it) } catch (e: Exception) {}
    }
    bubble = null
    target?.let {
      try { windowManager?.removeView(it) } catch (e: Exception) {}
    }
    target = null
    super.onDestroy()
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
      .setContentText("اضغط الدائرة وقل اسم التطبيق")
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
      x = dp(12)
      y = dp(240)
    }

    var startX = 0
    var startY = 0
    var touchX = 0f
    var touchY = 0f
    var moved = false
    var near = false
    view.setOnTouchListener { v, e ->
      when (e.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = lp.x; startY = lp.y; touchX = e.rawX; touchY = e.rawY; moved = false; near = false
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
            // تلتصق بأقرب حافة جانبية بعد الإفلات
            val goRight = lp.x + size / 2 > screenW() / 2
            lp.x = if (goRight) screenW() - size - dp(8) else dp(8)
            try { wm.updateViewLayout(v, lp) } catch (ex: Exception) {}
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

  private fun onBubbleTap() {
    val current = engine
    if (current != null && current.listening) {
      current.release()
      engine = null
      look(false)
      return
    }
    current?.release()
    val e = SpeechEngine(
      applicationContext,
      { state ->
        InstalledAppsModule.emitState(state, "bubble")
        look(state == "listening" || state == "hearing")
      },
      { list ->
        if (!InstalledAppsModule.emitResult(list, "bubble")) {
          toast("افتح تطبيق \"افتح لي\" مرة واحدة ثم حاول تاني")
        }
      },
      { code ->
        look(false)
        toast(speechErrorMessage(code))
      }
    )
    engine = e
    e.start()
  }
}
