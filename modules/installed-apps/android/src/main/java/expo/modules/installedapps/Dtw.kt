package expo.modules.installedapps

import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// مسافة DTW (Dynamic Time Warping) بين بصمتين.
//
// الإطارات موحدة الطول (L2-normalized) بعد CMN، فالمسافة بين إطارين ≤ 2
// والنتيجة النهائية (متوسط طول المسار) محدودة في [0..2]:
//   نفس الكلمة لنفس المتحدث عادة < ~0.6، وكلمتان مختلفتان أعلى من ذلك.
// نستخدم نطاق Sakoe-Chiba (قيود النافذة) لمنع الانحراف الشديد في المسار
// ولأن التسجيلات مقصوصة بـ VAD فالبداية والنهاية متقاربة أصلًا.
object Dtw {
  /** أفضل مسافة (أدنى) بين بصمة قادمة وأي قالب من قوالب بصمة مسجّلة. */
  fun bestMatch(query: Array<FloatArray>, templates: List<Array<FloatArray>>): Float {
    var best = Float.MAX_VALUE
    for (t in templates) {
      val d = distance(query, t)
      if (d < best) best = d
    }
    return best
  }

  fun distance(a: Array<FloatArray>, b: Array<FloatArray>): Float {
    val n = a.size
    val m = b.size
    if (n == 0 || m == 0) return Float.MAX_VALUE
    val window = max(20, (0.25f * max(n, m)).toInt())
    val INF = Float.MAX_VALUE / 4
    val d = Array(n) { FloatArray(m) { INF } }
    d[0][0] = frameDist(a[0], b[0])
    for (i in 1 until n) {
      if (i <= window) d[i][0] = d[i - 1][0] + frameDist(a[i], b[0])
    }
    for (j in 1 until m) {
      if (j <= window) d[0][j] = d[0][j - 1] + frameDist(a[0], b[j])
    }
    for (i in 1 until n) {
      val jLo = max(1, i - window)
      val jHi = min(m - 1, i + window)
      for (j in jLo..jHi) {
        val cost = frameDist(a[i], b[j])
        d[i][j] = cost + min(d[i - 1][j], min(d[i][j - 1], d[i - 1][j - 1]))
      }
    }
    // تقريب طول المسار بـ (n + m) — قياس مستقر يمنع تفضيل التسجيلات الطويلة
    return d[n - 1][m - 1] / (n + m)
  }

  private fun frameDist(x: FloatArray, y: FloatArray): Float {
    var s = 0.0
    for (i in x.indices) {
      val d = x[i] - y[i]
      s += d.toDouble() * d
    }
    return sqrt(s).toFloat()
  }
}
