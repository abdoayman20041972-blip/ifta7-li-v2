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
process.exit(failed || failed2 ? 1 : 0);
