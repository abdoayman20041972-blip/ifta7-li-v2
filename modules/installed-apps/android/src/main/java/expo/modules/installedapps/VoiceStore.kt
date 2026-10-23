package expo.modules.installedapps

import android.content.Context
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

// مخزن البصمات الصوتية: ملف ثنائي لكل تطبيق + فهرس JSON.
//
// بصمة واحدة لكل تطبيق (MVP): إعادة التسجيل تستبدل القديمة.
// كل بصمة تحتوي 3 قوالب MFCC (3 عينات من نفس الكلمة) والمطابقة تأخذ
// أفضل مسافة بين التسجيلة الجديدة وأي قالب — هذا يرفع التسامح مع
// تباين النطق الطبيعي بين المرات.
object VoiceStore {
  const val VERSION = 1

  data class Entry(val id: String, val pkg: String, val phrase: String, val file: String)

  private fun dir(ctx: Context): File = File(ctx.filesDir, "voiceprints").apply { mkdirs() }

  private fun idxFile(ctx: Context): File = File(dir(ctx), "index.json")

  private fun safePkg(pkg: String) = pkg.replace(Regex("[^A-Za-z0-9._]"), "_")

  fun list(ctx: Context): List<Entry> {
    val f = idxFile(ctx)
    if (!f.exists()) return emptyList()
    return try {
      val arr = org.json.JSONArray(f.readText())
      (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("id")
        if (id.isEmpty()) null else Entry(id, o.optString("pkg"), o.optString("phrase"), o.optString("file"))
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun count(ctx: Context): Int = list(ctx).size

  fun findForPkg(ctx: Context, pkg: String): Entry? = list(ctx).firstOrNull { it.pkg == pkg }

  /** يحفظ بصمة جديدة (ويستبدل أي بصمة لنفس التطبيق). */
  fun save(ctx: Context, pkg: String, phrase: String, templates: List<Array<FloatArray>>): Boolean {
    return try {
      val d = dir(ctx)
      val file = "${safePkg(pkg)}.bin"
      java.io.FileOutputStream(File(d, file)).use { fo ->
        DataOutputStream(fo).use { out ->
          out.writeInt(VERSION)
          out.writeInt(Mfcc.SR)
          out.writeInt(templates.size)
          for (t in templates) {
            out.writeInt(t.size)
            if (t.isNotEmpty()) {
              out.writeInt(t[0].size)
              for (frame in t) for (x in frame) out.writeFloat(x)
            } else {
              out.writeInt(0)
            }
          }
        }
      }
      // حدّث الفهرس: أزل نفس pkg ثم أضف
      val rest = list(ctx).filter { it.pkg != pkg }
      val arr = org.json.JSONArray()
      val e = org.json.JSONObject()
        .put("id", pkg)
        .put("pkg", pkg)
        .put("phrase", phrase)
        .put("file", file)
      arr.put(e)
      for (r in rest) arr.put(org.json.JSONObject().put("id", r.id).put("pkg", r.pkg).put("phrase", r.phrase).put("file", r.file))
      idxFile(ctx).writeText(arr.toString())
      true
    } catch (e: Exception) {
      false
    }
  }

  fun delete(ctx: Context, id: String): Boolean {
    return try {
      val e = list(ctx).firstOrNull { it.id == id } ?: return false
      File(dir(ctx), e.file).delete()
      val rest = list(ctx).filter { it.id != id }
      val arr = org.json.JSONArray()
      for (r in rest) arr.put(org.json.JSONObject().put("id", r.id).put("pkg", r.pkg).put("phrase", r.phrase).put("file", r.file))
      idxFile(ctx).writeText(arr.toString())
      true
    } catch (e: Exception) {
      false
    }
  }

  /** يحمّل قوالب بصمة (لأداء أفضل تُحمّل البصمات عند المطابقة مباشرة — الملفات صغيرة). */
  fun load(ctx: Context, entry: Entry): List<Array<FloatArray>>? {
    return try {
      val f = File(dir(ctx), entry.file)
      if (!f.exists()) return null
      DataInputStream(f.inputStream().buffered()).use { inp ->
        val ver = inp.readInt()
        if (ver != VERSION) return null
        inp.readInt() // sampleRate (مستقبليًا: أعدّل لو تغيّر)
        val nT = inp.readInt()
        val ts = ArrayList<Array<FloatArray>>(nT)
        for (t in 0 until nT) {
          val nFrames = inp.readInt()
          val dims = inp.readInt()
          if (nFrames <= 0 || dims <= 0) return null
          val arr = Array(nFrames) { FloatArray(dims) }
          for (i in 0 until nFrames) for (j in 0 until dims) arr[i][j] = inp.readFloat()
          ts.add(arr)
        }
        ts
      }
    } catch (e: Exception) {
      null
    }
  }
}
