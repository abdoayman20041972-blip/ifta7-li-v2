package expo.modules.installedapps

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

fun speechErrorMessage(code: Int): String = when (code) {
  SpeechRecognizer.ERROR_NO_MATCH -> "ما فهمتش الكلام، حاول تاني"
  SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "ما سمعتش صوت، حاول تاني"
  SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "إذن الميكروفون مطلوب"
  SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "التعرف على الكلام يحتاج إنترنت"
  SpeechRecognizer.ERROR_AUDIO -> "مشكلة في الميكروفون"
  SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "الميكروفون مشغول، حاول بعد لحظة"
  12, 13 -> "اللغة العربية غير متاحة في خدمة الكلام"
  -1 -> "خدمة التعرف على الكلام غير متاحة (تأكد من تطبيق Google)"
  else -> "تعذر التعرف على الكلام (رمز $code)"
}

// محرك التعرف على الكلام — singleton واحد يتشاركه التطبيق والدائرة العائمة.
//
// لماذا singleton؟ إنشاء أكثر من SpeechRecognizer في نفس اللحظة يسبب
// ERROR_RECOGNIZER_BUSY، وكان يحدث فعلًا: محرك التطبيق (InstalledAppsModule)
// ومحرك الدائرة (BubbleService) كانا ينشئان كلٌّ محركه المستقل.
// القاعدة الآن: آخر من يطلب الاستماع يفوز، وإفراج السابق تلقائي.
// كل الاستدعاءات يجب أن تتم من الخيط الرئيسي (شرط SpeechRecognizer).
object SpeechEngine {
  private var recognizer: SpeechRecognizer? = null
  private var stateCb: (String) -> Unit = {}
  private var resultCb: (List<String>) -> Unit = {}
  private var errorCb: (Int) -> Unit = {}

  @Volatile
  var listening: Boolean = false
    private set

  fun isAvailable(context: Context): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

  fun start(
    context: Context,
    onState: (String) -> Unit,
    onResult: (List<String>) -> Unit,
    onError: (Int) -> Unit
  ) {
    release()
    if (!isAvailable(context)) {
      onError(-1)
      return
    }
    stateCb = onState
    resultCb = onResult
    errorCb = onError
    val r = SpeechRecognizer.createSpeechRecognizer(context.applicationContext)
    recognizer = r
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) { listening = true; stateCb("listening") }
      override fun onBeginningOfSpeech() { stateCb("hearing") }
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() { stateCb("processing") }
      override fun onPartialResults(partialResults: Bundle?) {}
      override fun onEvent(eventType: Int, params: Bundle?) {}
      override fun onError(error: Int) {
        listening = false
        stateCb("idle")
        errorCb(error)
      }
      override fun onResults(results: Bundle?) {
        listening = false
        stateCb("idle")
        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.filter { it.isNotBlank() } ?: emptyList()
        if (list.isEmpty()) errorCb(SpeechRecognizer.ERROR_NO_MATCH) else resultCb(list)
      }
    })
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar-EG")
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ar-EG")
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
      // نطلب الأوفلاين أولوية إن كانت حزمة التعرف محملة على الجهاز.
      // إضافة تجريبية (API 23+): إن لم تؤثر عند مزود الخدمة فلا ضرر منها.
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      // ===== مهلات الصمت (المرحلة 3) =====
      // إكسترات قياسية منذ API 8 (آمنة — بعكس EXTRA_BIAS_STRINGS/CONFIDENCE المقيدة على API 33+).
      // من غيرها يبقى الاستماع مفتوحًا مدة طويلة على realme UI بعد سكوت المستخدم،
      // فتتأخر النتيجة ويبدو النظام بطيئًا. القيم: أقل استماع 1.5s،
      // وإن سكت 1.2s بعد كلام محتمل أو 0.9s بعد كلام مؤكد نقطع وننشر النتيجة.
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L)
    }
    r.startListening(intent)
  }

  fun release() {
    listening = false
    recognizer?.let {
      try { it.cancel() } catch (e: Exception) {}
      try { it.destroy() } catch (e: Exception) {}
    }
    recognizer = null
  }
}
