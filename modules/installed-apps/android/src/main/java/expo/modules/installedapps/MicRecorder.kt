package expo.modules.installedapps

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder

// المسجّل الذاتي الواحد: AudioRecord + كشف نشاط صوتي (VAD) بالطاقة.
//
// هذا هو «التسجيلة الواحدة» في معمارية الطبقات: نسجل مرة واحدة بناية
// (بلا أي خدمة تعرف كلام أخرى تعمل في نفس اللحظة) ثم تمر البصمة على الطبقات.
// يعمل فقط من خيط عامل — لا تستدعِ recordUtterance من الخيط الرئيسي أبدًا.
//
// VAD بسيط وموثوق: نقيس ضجيج الخلفية في أول 300ms، ثم ننتظر كلامًا
// (طاقة فوق الحد 3 إطارات متتالية) ونغلق بعد 650ms صمت (أو 5 ثوانٍ حدًا أقصى).
@SuppressLint("MissingPermission") // إذن RECORD_AUDIO يُطلب قبل الاستدعاء
class MicRecorder(private val sampleRate: Int = Mfcc.SR) {
  companion object {
    private const val MAX_MS = 5000
    private const val AMBIENT_FRAMES = 30 // 300ms قياس الخلفية
    private const val SPEECH_MIN_FRAMES = 3 // 30ms كلام متواصل = بداية
    private const val SILENCE_FRAMES = 65 // 650ms صمت = نهاية
    private const val PRE_FRAMES = 25 // نحتفظ بـ 250ms قبل بداية الكلام
    private const val AMBIENT_FACTOR = 2.5 // حد الكلام = ضجيج × 2.5
    private const val MIN_THRESHOLD = 500.0 // حد أدنى مطلق للطاقة
  }

  /** يعيد PCM مقصوصًا أو null لو انتهى الحد الأقصى دون كلام واضح. */
  fun recordUtterance(): ShortArray? {
    val minBuf = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val bufSize = maxOf(minBuf, sampleRate) // ثانية كاملة على الأقل
    val rec = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      sampleRate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      bufSize
    )
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      return null
    }
    val hop = sampleRate / 100 // 10ms
    val buf = ShortArray(hop)
    val pre = ArrayList<ShortArray>(PRE_FRAMES + 1)
    val speech = ArrayList<ShortArray>(512)
    var started = false
    var speechFrames = 0
    var silenceFrames = 0
    var totalFrames = 0
    val maxFrames = MAX_MS / 10
    var ambientSum = 0.0
    var threshold = MIN_THRESHOLD

    try {
      rec.startRecording()
      while (totalFrames < maxFrames) {
        val n = rec.read(buf, 0, hop)
        if (n <= 0) continue
        totalFrames++
        var sum = 0.0
        for (i in 0 until n) {
          val s = buf[i].toDouble()
          sum += s * s
        }
        val rms = Math.sqrt(sum / n)

        if (!started && totalFrames <= AMBIENT_FRAMES) {
          // مرحلة قياس الخلفية: نحتفظ بما يُقال أيضًا (المستخدم قد يتكلم فورًا)
          ambientSum += rms
          pre.add(buf.copyOf(n))
          if (pre.size > PRE_FRAMES) pre.removeAt(0)
          if (totalFrames == AMBIENT_FRAMES) {
            val ambientAvg = ambientSum / AMBIENT_FRAMES
            threshold = Math.max(ambientAvg * AMBIENT_FACTOR, MIN_THRESHOLD)
          }
          continue
        }

        if (!started) {
          if (rms > threshold) {
            speechFrames++
            if (speechFrames >= SPEECH_MIN_FRAMES) {
              started = true
              speech.addAll(pre)
              pre.clear()
              speech.add(buf.copyOf(n))
              silenceFrames = 0
            } else {
              pre.add(buf.copyOf(n))
              if (pre.size > PRE_FRAMES) pre.removeAt(0)
            }
          } else {
            speechFrames = 0
            pre.add(buf.copyOf(n))
            if (pre.size > PRE_FRAMES) pre.removeAt(0)
          }
        } else {
          speech.add(buf.copyOf(n))
          if (rms <= threshold) {
            silenceFrames++
            if (silenceFrames >= SILENCE_FRAMES) break
          } else {
            silenceFrames = 0
          }
        }
      }
    } catch (e: Exception) {
      return null
    } finally {
      try { rec.stop() } catch (e: Exception) {}
      rec.release()
    }

    if (!started) return null
    var total = 0
    for (c in speech) total += c.size
    if (total < sampleRate / 10) return null // أقل من 100ms — لا شيء مفيد
    val out = ShortArray(total)
    var o = 0
    for (c in speech) {
      c.copyInto(out, o)
      o += c.size
    }
    return out
  }
}
