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

// يغلّف SpeechRecognizer. كل الدوال يجب أن تُستدعى من الخيط الرئيسي.
class SpeechEngine(
  private val context: Context,
  private val stateCb: (String) -> Unit,
  private val resultCb: (List<String>) -> Unit,
  private val errorCb: (Int) -> Unit
) {
  private var recognizer: SpeechRecognizer? = null
  var listening: Boolean = false
    private set

  companion object {
    fun isAvailable(context: Context): Boolean = SpeechRecognizer.isRecognitionAvailable(context)
  }

  fun start() {
    release()
    if (!isAvailable(context)) {
      errorCb(-1)
      return
    }
    val r = SpeechRecognizer.createSpeechRecognizer(context)
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
