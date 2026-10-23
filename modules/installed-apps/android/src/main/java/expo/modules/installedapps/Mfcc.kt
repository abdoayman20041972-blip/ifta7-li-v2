package expo.modules.installedapps

import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sqrt

// استخراج بصمة MFCC من صوت PCM — كوتلن صِرف بلا أي مكتبات أو موديلات.
//
// 16kHz أحادي: إطار 400 عينة (25ms) وقفزة 160 (10ms)، 26 مرشّح ميلي، 13 معاملًا.
// بعد الاستخراج: CMN (طرح متوسط كل معامل على مستوى التسجيلة) يقلل أثر الميكروفون
// والقناة الصوتية، ثم تطبيع L2 لكل إطار — النتيجة: المسافة بين أي إطارين
// محدودة في [0..2] ومسافة DTW المتوسطة قابلة للمقارنة بين الأجهزة.
object Mfcc {
  const val SR = 16000
  private const val FRAME = 400
  private const val HOP = 160
  private const val FFT_SIZE = 512
  private const val N_MEL = 26
  private const val N_CEP = 13
  private const val F_MIN = 50.0
  private const val F_MAX = 7600.0

  // جداول تُحسب مرة واحدة
  private val hamming = DoubleArray(FRAME) { i -> 0.54 - 0.46 * cos(2.0 * Math.PI * i / (FRAME - 1)) }
  private val melFb = Array(N_MEL) { DoubleArray(FFT_SIZE / 2 + 1) }
  private val dctMat = Array(N_CEP) { DoubleArray(N_MEL) }

  @Volatile
  private var ready = false

  private fun hz2mel(f: Double): Double = 2595.0 * log10(1.0 + f / 700.0)
  private fun mel2hz(m: Double): Double = 700.0 * (10.0.pow(m / 2595.0) - 1.0)

  private fun init() {
    if (ready) return
    synchronized(this) {
      if (ready) return
      val melMin = hz2mel(F_MIN)
      val melMax = hz2mel(F_MAX)
      val centers = DoubleArray(N_MEL + 2) { i -> mel2hz(melMin + (melMax - melMin) * i / (N_MEL + 1)) }
      val binHz = SR.toDouble() / FFT_SIZE
      for (m in 0 until N_MEL) {
        val lo = centers[m] / binHz
        val mid = centers[m + 1] / binHz
        val hi = centers[m + 2] / binHz
        val kLo = ceil(lo).toInt().coerceAtLeast(0)
        val kMid = floor(mid).toInt()
        val kHi = floor(hi).toInt().coerceAtMost(FFT_SIZE / 2)
        for (k in 0..FFT_SIZE / 2) {
          val w = when {
            k in kLo..kMid -> (k - lo) / (mid - lo)
            k in kMid + 1..kHi -> (hi - k) / (hi - mid)
            else -> 0.0
          }
          melFb[m][k] = w
        }
      }
      for (i in 0 until N_CEP) {
        for (j in 0 until N_MEL) {
          dctMat[i][j] = cos(Math.PI * i * (2 * j + 1) / (2.0 * N_MEL)) *
            (if (i == 0) sqrt(1.0 / N_MEL) else sqrt(2.0 / N_MEL))
        }
      }
      ready = true
    }
  }

  /** يعيد مصفوفة إطارات، كل إطار 13 معاملًا بعد CMN وتطبيع L2. */
  fun extract(pcm: ShortArray): Array<FloatArray> {
    init()
    val frames = if (pcm.size < FRAME) 0 else (pcm.size - FRAME) / HOP + 1
    if (frames <= 0) return emptyArray()
    val re = DoubleArray(FFT_SIZE)
    val im = DoubleArray(FFT_SIZE)
    val pow = DoubleArray(FFT_SIZE / 2 + 1)
    val melE = DoubleArray(N_MEL)
    val out = ArrayList<FloatArray>(frames)
    for (f in 0 until frames) {
      val off = f * HOP
      var prev = 0.0
      for (i in 0 until FRAME) {
        val s = pcm[off + i] / 32768.0
        val x = s - 0.97 * prev
        prev = s
        re[i] = x * hamming[i]
        im[i] = 0.0
      }
      for (i in FRAME until FFT_SIZE) {
        re[i] = 0.0
        im[i] = 0.0
      }
      fft(re, im)
      var e = 0.0
      for (k in pow.indices) {
        pow[k] = re[k] * re[k] + im[k] * im[k]
        e += pow[k]
      }
      if (e < 1e-9) continue // إطار صامت تمامًا
      for (m in 0 until N_MEL) {
        var s = 0.0
        for (k in pow.indices) s += melFb[m][k] * pow[k]
        melE[m] = kotlin.math.ln(s + 1e-10)
      }
      val v = FloatArray(N_CEP)
      for (i in 0 until N_CEP) {
        var s = 0.0
        for (j in 0 until N_MEL) s += dctMat[i][j] * melE[j]
        v[i] = s.toFloat()
      }
      out.add(v)
    }
    // CMN ثم تطبيع L2 لكل إطار
    val n = out.size
    if (n > 0) {
      val mean = FloatArray(N_CEP)
      for (v in out) for (i in 0 until N_CEP) mean[i] += v[i]
      for (i in 0 until N_CEP) mean[i] /= n
      for (v in out) {
        for (i in 0 until N_CEP) v[i] -= mean[i]
        var s = 0.0
        for (x in v) s += x.toDouble() * x
        val norm = sqrt(s).toFloat()
        if (norm > 1e-6f) for (i in v.indices) v[i] /= norm
      }
    }
    return out.toTypedArray()
  }

  // FFT ثنائي الجذر تكراري (in-place)
  private fun fft(re: DoubleArray, im: DoubleArray) {
    val n = re.size
    var j = 0
    for (i in 1 until n) {
      var bit = n shr 1
      while (j and bit != 0) {
        j = j xor bit
        bit = bit shr 1
      }
      j = j or bit
      if (i < j) {
        re[i] = re[j].also { re[j] = re[i] }
        im[i] = im[j].also { im[j] = im[i] }
      }
    }
    var len = 2
    while (len <= n) {
      val ang = -2.0 * Math.PI / len
      val wr = cos(ang)
      val wi = kotlin.math.sin(ang)
      var i = 0
      while (i < n) {
        var cr = 1.0
        var ci = 0.0
        val half = len / 2
        for (k in 0 until half) {
          val ur = re[i + k]
          val ui = im[i + k]
          val vr = re[i + k + half] * cr - im[i + k + half] * ci
          val vi = re[i + k + half] * ci + im[i + k + half] * cr
          re[i + k] = ur + vr
          im[i + k] = ui + vi
          re[i + k + half] = ur - vr
          im[i + k + half] = ui - vi
          val ncr = cr * wr - ci * wi
          ci = cr * wi + ci * wr
          cr = ncr
        }
        i += len
      }
      len = len shl 1
    }
  }
}
