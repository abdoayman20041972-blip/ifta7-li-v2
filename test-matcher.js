const { understand } = require('./matcher');

// [الأمر, التطبيق المتوقع أو null لو المفروض ما يفهمش]
const cases = [
  ['افتح واتساب', 'واتساب'],
  ['افتحلي الواتس', 'واتساب'],
  ['شغللي يوتيوب', 'يوتيوب'],
  ['عايز افتح يوتوب', 'يوتيوب'],
  ['open youtube', 'يوتيوب'],
  ['Open WhatsApp please', 'واتساب'],
  ['افتح الفيس', 'فيسبوك'],
  ['افتح فيس بوك', 'فيسبوك'],
  ['وديني على ماسنجر', 'ماسنجر'],
  ['افتح انستا', 'إنستجرام'],
  ['شغل تيك توك', 'تيك توك'],
  ['افتح تلجرام', 'تليجرام'],
  ['افتح الإعدادات', 'الإعدادات'],
  ['اعدادات', 'الإعدادات'],
  ['افتح جوجل كروم', 'كروم'],
  ['افتح المتصفح', 'كروم'],
  ['افتح خرائط جوجل', 'خرائط جوجل'],
  ['افتح جوجل', 'جوجل'],
  ['افتح خريطه', 'خرائط جوجل'],
  ['افتح بلاي ستور', 'متجر Play'],
  ['افتح واتسااب', 'واتساب'],          // خطأ إملائي
  ['يوتيوبب', 'يوتيوب'],                // خطأ إملائي
  ['افتح الصور', 'الصور'],
  ['افتح سبوتفاي', 'سبوتيفاي'],         // خطأ إملائي
  ['افتح الجيميل', 'جيميل'],
  ['افتح الكاميرا', null],              // غير موجود في القائمة
  ['ازيك عامل ايه', null],
  ['', null],
  ['افتح', null],
  ['افتح برنامج الحسابات', null],
];

let failed = 0;
for (const [cmd, expected] of cases) {
  const r = understand(cmd);
  const got = r ? r.app.name : null;
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | "${cmd}" -> ${got}${r ? ` (${r.score.toFixed(2)}${r.ambiguous ? ', غامض' : ''})` : ''}${ok ? '' : `  | المتوقع: ${expected}`}`);
}
console.log(`\n${cases.length - failed}/${cases.length} نجحت (القائمة الجاهزة)`);

// ===== اختبارات التطبيقات المثبتة والأوامر المخصصة =====
const { buildApps } = require('./appList');
const installed = buildApps([
  { name: 'WhatsApp', pkg: 'com.whatsapp' },
  { name: 'Google Maps', pkg: 'com.google.android.apps.maps' },
  { name: 'Google Photos', pkg: 'com.google.android.apps.photos' },
  { name: 'Google', pkg: 'com.google.android.googlequicksearchbox' },
  { name: 'Camera', pkg: 'com.sec.android.app.camera' },
  { name: 'Calculator', pkg: 'com.sec.android.app.popupcalculator' },
  { name: 'مزرعتي الذكية', pkg: 'com.example.farm' },
  { name: 'Vodafone Ana', pkg: 'com.emeint.android.myservices' },
]);
const custom = [
  { phrase: 'الصور القديمة', pkg: 'com.google.android.apps.photos', name: 'Google Photos' },
  { phrase: 'مكالمات', pkg: 'com.example.dialer', name: 'Dialer' }, // غير موجود في القائمة المثبتة
];

const cases2 = [
  ['open camera', 'Camera', undefined],            // تطبيق غير موجود في القائمة الجاهزة
  ['افتح calculator', 'Calculator', undefined],
  ['افتح الواتس', 'WhatsApp', undefined],           // اسم دارج + تطبيق مثبت
  ['افتح maps', 'Google Maps', undefined],          // جزء من اسم أطول
  ['افتح جوجل', 'Google', undefined],
  ['افتح مزرعتي', 'مزرعتي الذكية', undefined],       // عربي من اسم التطبيق نفسه
  ['افتح الصور القديمة', 'Google Photos', custom],  // أمر مخصص
  ['شغللي مكالمات', 'Dialer', custom],              // أمر مخصص لحزمة غير ظاهرة
  ['افتح الصور', 'Google Photos', custom],          // الأمر المخصص لا يكسر المطابقة العادية
  ['افتح تيك توك', null, undefined],                // غير مثبت: لا يفتح شيئاً آخر
  ['افتح فودافون', null, undefined],                // لا يوجد اسم عربي للتطبيق: يحتاج أمراً مخصصاً
  ['افتح فودافون', 'Vodafone Ana', [{ phrase: 'فودافون', pkg: 'com.emeint.android.myservices', name: 'Vodafone Ana' }]],
];
let failed2 = 0;
for (const [cmd, expected, cust] of cases2) {
  const r = understand(cmd, installed, cust || []);
  const got = r ? r.app.name : null;
  const ok = got === expected;
  if (!ok) failed2++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | "${cmd}" -> ${got}${ok ? '' : `  | المتوقع: ${expected}`}`);
}
console.log(`\n${cases2.length - failed2}/${cases2.length} نجحت (المثبتة والمخصصة)`);

// ===== اختبارات الثقة: متى ننفّذ فورًا ومتى نطلب تأكيدًا، ومنع الفتح الخاطئ =====
const similarApps = buildApps([
  { name: 'WhatsApp', pkg: 'com.whatsapp' },
  { name: 'WhatsApp Business', pkg: 'com.whatsapp.w4b' },
  { name: 'YouTube', pkg: 'com.google.android.youtube' },
  { name: 'YouTube Music', pkg: 'com.google.android.apps.youtube.music' },
  { name: 'Google', pkg: 'com.google.android.googlequicksearchbox' },
  { name: 'Google Maps', pkg: 'com.google.android.apps.maps' },
  { name: 'Google Photos', pkg: 'com.google.android.apps.photos' },
]);
const vodaApps = buildApps([{ name: 'Vodafone Ana', pkg: 'com.emeint.android.myservices' }]);
const onlyGoogleFamily = buildApps([
  { name: 'Google Maps', pkg: 'com.google.android.apps.maps' },
  { name: 'Google Photos', pkg: 'com.google.android.apps.photos' },
]);

// [الأمر, التطبيق المتوقع, هل ننفّذ فورًا؟, قائمة التطبيقات]
const cases3 = [
  ['افتح يوتيوب', 'YouTube', true, similarApps],
  ['افتح يوتيوب ميوزيك', 'YouTube Music', true, similarApps],   // كان يفتح YouTube خطأً
  ['افتح اليوتيوب ميوزيك', 'YouTube Music', true, similarApps],
  ['افتح واتساب', 'WhatsApp', true, similarApps],
  ['افتح واتساب بيزنس', 'WhatsApp Business', true, similarApps], // كان يفتح WhatsApp خطأً
  ['افتح جوجل', 'Google', true, similarApps],                   // تطابق تام يغلب الأسماء الأطول
  ['افتح maps', 'Google Maps', true, similarApps],              // اسم دارج مسجّل في apps.js → فوري
  ['افتح vodafone', 'Vodafone Ana', false, vodaApps],           // جزء من اسم أطول غير مسجّل → تأكيد
  ['افتح خرائط', 'Google Maps', true, similarApps],
  ['افتح مقاطع واتساب', 'WhatsApp', false, similarApps],        // كلمة زائدة لم تُفهم → تأكيد
  ['افتح واتسااب', 'WhatsApp', false, similarApps],             // تقريب إملائي → تأكيد
  ['افتح يوتيوبب', 'YouTube', false, similarApps],
  ['افتح جوجل', 'Google Maps', false, onlyGoogleFamily],        // غامض بين Maps وPhotos → تأكيد (أيهما يظهر أولًا)
];
let failed3 = 0;
for (const [cmd, expected, wantConfident, list] of cases3) {
  const r = understand(cmd, list, []);
  const got = r ? r.app.name : null;
  const isAmbiguousCase = list === onlyGoogleFamily;
  // في الحالة الغامضة نتحقق فقط أنه غير واثق وأنه مرشَّح بين الخيارات
  const nameOk = isAmbiguousCase ? !!r && [r.app, ...r.others].some((a) => a.name === expected) : got === expected;
  const ok = nameOk && !!r && r.confident === wantConfident;
  if (!ok) failed3++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | "${cmd}" -> ${got}${r ? ` (${r.score.toFixed(2)}, ${r.confident ? 'فوري' : 'تأكيد'})` : ''}${ok ? '' : `  | المتوقع: ${expected} / ${wantConfident ? 'فوري' : 'تأكيد'}`}`);
}
console.log(`\n${cases3.length - failed3}/${cases3.length} نجحت (الثقة والتأكيد)`);

// الأمر المخصص دائمًا فوري
{
  const r = understand('مزرعتي', similarApps, [{ phrase: 'مزرعتي', pkg: 'com.example.farm', name: 'Farm' }]);
  const ok = !!r && r.custom && r.confident;
  if (!ok) failed3++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | الأمر المخصص فوري`);
}

// ===== اختبارات الصيغ المتعددة القادمة من التعرف الصوتي =====
{
  const { understandBest } = require('./matcher');
  const alt = [
    // [الصيغ بالترتيب, التطبيق المتوقع, فوري؟]
    [['افتح واتساب', 'افتح وتساب'], 'WhatsApp', true],
    [['افتح واتسااب', 'افتح واتساب'], 'WhatsApp', true],            // الأولى تقريبية، والثانية تؤكد نفس التطبيق
    [['افتح مقاطع واتساب', 'افتح واتساب'], 'WhatsApp', true],       // الثانية تؤكد نفس التطبيق
    [['ازيك عامل ايه', 'افتح يوتيوب'], 'YouTube', false],           // الأولى لا تُفهم: نطلب تأكيدًا ولا ننفّذ
    [['افتح مقاطع واتساب'], 'WhatsApp', false],
  ];
  let failed4 = 0;
  for (const [cmds, expected, wantConfident] of alt) {
    const r = understandBest(cmds, similarApps, []);
    const ok = !!r && r.app.name === expected && r.confident === wantConfident;
    if (!ok) failed4++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} | [${cmds.join(' | ')}] -> ${r ? r.app.name + (r.confident ? ' (فوري)' : ' (تأكيد)') : null}`);
  }
  console.log(`\n${alt.length - failed4}/${alt.length} نجحت (الصيغ المتعددة)`);
  failed3 += failed4;
}

process.exit(failed || failed2 || failed3 ? 1 : 0);
