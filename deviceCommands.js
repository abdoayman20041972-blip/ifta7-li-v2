// أوامر الجهاز: قاموس مغلق صغير يُفحص قبل مطابقة التطبيقات.
//
// لماذا قاموس مغلق؟ لأن أوامر الجهاز (كشاف، آخر تطبيق) لا تخضع لفضاء
// أسماء التطبيقات، وأي محاولة لفهم حر ستُصطاد بجُمل التطبيقات بالخطأ
// (مثل "افتح ساعة النور"). لذلك القاعدة: صيغ محددة وقصيرة فقط،
// وكل جملة فيها كلمة زائدة تُرك للمطابِق العادي للأسماء.
//
// يعيد: { type: 'torch', on: true|false } | { type: 'last' } | null
// JS صِرف بلا مكتبات — قابل للاختبار بـ node مثل matcher وcommandStore.

const { normalize } = require('./matcher');

// كلمات الفلاش (بعد التطبيع: ة→ه، إزالة التطويل)
const TORCH = new Set(['كشاف', 'نور', 'ضوء', 'ضوا', 'لمبه']);
// ملاحظة: «نور» هنا اسم الفلاش فقط، وليست فعلًا — لو اعتبرناها فعلًا
// لتفاضض «اطفي النور» (فعل إطفاء + فعل إشعال) وعتّلنا الأمر.
const ON_STEMS = ['افتح', 'فتح', 'شغل', 'ضوي', 'ولع', 'هات', 'اضوي'];
const OFF_STEMS = ['اطفي', 'اقفل', 'قفل', 'شيل', 'سد'];
// لواحق الضمائر الملتصقة بالأفعال (افتحلي، شغلي، اطفيها، اقفلو...)
const SUF = new Set(['', 'ي', 'لي', 'ني', 'ها', 'ه', 'هم', 'هو', 'و', 'وا', 'ك', 'لها', 'هالي']);
// كلمات «آخر تطبيق»
const LAST = new Set(['اخر', 'اخير', 'فات']);
// أهداف الإعدادات (المرحلة 5): التبديل البرمجي مُنع رسميًا في API 29+
// فالأمر كلّه يفتح اللوحة/الشاشة المناسبة، سواء قال المستخدم شغل أو اقفل.
const SETTINGS = [
  ['airplane', new Set(['طيران'])],
  ['bluetooth', new Set(['بلوتوث', 'بلوتوت'])],
  ['wifi', new Set(['واي', 'وافي', 'وفاي', 'وايفاي', 'فاي', 'نت', 'انترنت', 'داتا', 'بيانات', 'شبكه'])],
];
// حشو مسموح داخل أوامر الجهاز فقط (افتح «آخر واحد» / «اللي فات» / «وضع الطيران»)
const FILLER = new Set(['واحد', 'ده', 'دا', 'لي', 'تاني', 'قبل', 'كده', 'وضع', 'الوضع']);

// إزالة «ال» التعريف (نفس منطق matcher.stripArticle لفردنا الخاص)
function stripAl(t) {
  return t.length > 3 && t.startsWith('ال') ? t.slice(2) : t;
}

// يصنّف فعلًا: 'on' | 'off' | null — بجذور ولواحق ليلتقط افتحلي/شغلي/اطفيها
function verbKind(t) {
  for (const s of ON_STEMS) {
    if (t === s || (t.startsWith(s) && SUF.has(t.slice(s.length)))) return 'on';
  }
  for (const s of OFF_STEMS) {
    if (t === s || (t.startsWith(s) && SUF.has(t.slice(s.length)))) return 'off';
  }
  return null;
}

function matchDeviceCommand(text) {
  const toks = normalize(text).split(' ').filter(Boolean);
  if (!toks.length || toks.length > 5) return null;
  const bare = toks.map(stripAl);

  const hasTorch = bare.some((t) => TORCH.has(t));
  const kinds = bare.map(verbKind);
  const hasOn = kinds.includes('on');
  const hasOff = kinds.includes('off');
  const extras = bare.filter((t, i) => !TORCH.has(t) && kinds[i] === null && !FILLER.has(t) && !LAST.has(t) && !SETTINGS.some(([, set]) => set.has(t)));

  if (hasTorch) {
    // فيه كلمة غريبة (اسم تطبيق غالبًا) → ليقرأه المطابِق العادي
    if (extras.length) return null;
    if (hasOff && !hasOn) return { type: 'torch', on: false };
    if (hasOn && !hasOff) return { type: 'torch', on: true };
    // «الكشاف» وحدها أو «نور الكشاف» (نور اسم وليست فعلًا) = إشعال
    if (!hasOn && !hasOff) return { type: 'torch', on: true };
    return null; // إشعال وإطفاء معًا — غامضة، نتجاهل
  }

  if (bare.some((t) => LAST.has(t))) {
    // «اللي فات»: لي حشو لكن وجود «فات» يكفي
    if (!extras.length || extras.every((t) => FILLER.has(t))) return { type: 'last' };
    return null;
  }

  // أهداف الإعدادات: هدف واحد فقط + بلا كلمات غريبة
  const hits = SETTINGS.filter(([, set]) => bare.some((t) => set.has(t)));
  if (hits.length === 1) {
    if (!extras.length || extras.every((t) => FILLER.has(t))) return { type: 'settings', target: hits[0][0] };
    return null; // فيه اسم تطبيق غالبًا — ليقرأه المطابِق العادي
  }
  return null;
}

module.exports = { matchDeviceCommand };
