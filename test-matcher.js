const { understand } = require('./matcher');
const KNOWN_LIST = require('./apps');

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
  ['افتح فودافون', 'Vodafone Ana', undefined],      // المرحلة 0: الجسر الصوتي يربط العربي بالإنجليزي دون أمر مخصص
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
  ['افتح vodafone', 'Vodafone Ana', true, vodaApps],            // أصبح مسجّلًا كاسم دارج في apps.js → فوري
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


// ===== المرحلة 0: الجسر الصوتي (عربي ↔ إنجليزي) وفهم الجمل غير المطابقة تمامًا =====
const bridgeApps = buildApps([
  { name: 'Spotify', pkg: 'x.spotify' }, { name: 'Netflix', pkg: 'x.netflix' }, { name: 'Telegram', pkg: 'x.telegram' },
  { name: 'Snapchat', pkg: 'x.snap' }, { name: 'Camera', pkg: 'x.camera' }, { name: 'Calculator', pkg: 'x.calc' },
  { name: 'Clock', pkg: 'x.clock' }, { name: 'My Files', pkg: 'x.files' }, { name: 'Gallery', pkg: 'x.gallery' },
  { name: 'Contacts', pkg: 'x.contacts' }, { name: 'Messages', pkg: 'x.messages' }, { name: 'Phone', pkg: 'x.phone' },
  { name: 'Notes', pkg: 'x.notes' }, { name: 'Weather', pkg: 'x.weather' }, { name: 'Settings', pkg: 'x.settings' },
  { name: 'Discord', pkg: 'x.discord' }, { name: 'Chrome', pkg: 'x.chrome' }, { name: 'Calendar', pkg: 'x.calendar' },
  { name: 'Google Maps', pkg: 'x.maps' }, { name: 'Samsung Health', pkg: 'x.health' }, { name: 'Truecaller', pkg: 'x.truecaller' },
  { name: 'Skype', pkg: 'x.skype' }, { name: 'Vodafone Ana', pkg: 'x.voda' }, { name: 'Instagram', pkg: 'x.insta' },
  { name: 'Tiktok', pkg: 'x.tiktok' }, { name: 'Zoom', pkg: 'x.zoom' }, { name: 'Microsoft Teams', pkg: 'x.teams' },
]);
// [الأمر, التطبيق المتوقع, فوري؟ (undefined = لا نتحقق)]
const cases5 = [
  // أسماء تجارية بحروف عربية ← اسم إنجليزي
  ['افتح سبوتيفاي', 'Spotify', true], ['افتح سبوتفاي', 'Spotify'], ['شغل نتفلكس', 'Netflix', true], ['افتح نتفليكس', 'Netflix', true],
  ['افتح تلجرام', 'Telegram', true], ['افتح تيليجرام', 'Telegram', true], ['افتح سناب شات', 'Snapchat', true], ['افتح سنابشات', 'Snapchat', true],
  ['افتح ديسكورد', 'Discord', true], ['افتح كروم', 'Chrome', true], ['افتح تروكولر', 'Truecaller', true], ['افتح سكايب', 'Skype', true],
  ['افتح انستجرام', 'Instagram', true], ['افتح انستغرام', 'Instagram', true], ['افتح تيك توك', 'Tiktok', true], ['افتح زوم', 'Zoom'],
  ['افتح تيمز', 'Microsoft Teams'], ['افتح مايكروسوفت تيمز', 'Microsoft Teams'], ['افتح خرائط جوجل', 'Google Maps'], ['افتح فودافون انا', 'Vodafone Ana'],
  // كلمات عامة: ترجمة وليست نطقًا
  ['افتح الكاميرا', 'Camera', true], ['افتحلي كاميرا', 'Camera', true], ['شغل الحاسبة', 'Calculator', true], ['افتح الساعة', 'Clock'], ['افتح المنبه', 'Clock'],
  ['افتح الملفات', 'My Files'], ['افتح الجاليري', 'Gallery'], ['افتح معرض الصور', 'Gallery'], ['افتح جهات الاتصال', 'Contacts'],
  ['افتح الرسائل', 'Messages'], ['افتح التليفون', 'Phone'], ['افتح الملاحظات', 'Notes'], ['افتح الطقس', 'Weather'], ['افتح الاعدادات', 'Settings'],
  ['افتح التقويم', 'Calendar'], ['افتح صحة سامسونج', 'Samsung Health'],
  // جمل إنجليزية طبيعية وأخطاء كتابة
  ['Can you open Spotify for me please', 'Spotify', true], ['launch the camera app', 'Camera', true], ['start netflix', 'Netflix', true],
  ['open spotfy', 'Spotify'], ['open instgram', 'Instagram'], ['open telegrm', 'Telegram'],
  // لهجات وبادئات وأفعال ملتصقة
  ['شغلهالي سبوتيفاي', 'Spotify', true], ['ممكن تفتحلي ديسكورد لو سمحت', 'Discord', true], ['وديني على التليجرام', 'Telegram', true],
  ['روح للتليجرام', 'Telegram'], ['افتح بالكاميرا', 'Camera'], ['عايز اشوف الطقس', 'Weather'], ['وريني الحاسبة', 'Calculator'],
];
let failed5 = 0;
for (const [cmd, expected, wantConfident] of cases5) {
  const r = understand(cmd, bridgeApps, []);
  const got = r ? r.app.name : null;
  const ok = got === expected && (wantConfident === undefined || (!!r && r.confident === wantConfident));
  if (!ok) failed5++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | "${cmd}" -> ${got}${r ? ` (${r.score.toFixed(2)}, ${r.confident ? 'فوري' : 'تأكيد'}${r.ambiguous ? ', غامض' : ''})` : ''}${ok ? '' : `  | المتوقع: ${expected}${wantConfident === undefined ? '' : ' / ' + (wantConfident ? 'فوري' : 'تأكيد')}`}`);
}
console.log(`\n${cases5.length - failed5}/${cases5.length} نجحت (الجسر الصوتي والمرادفات واللهجات)`);

// ===== منع الفتح الخاطئ: جمل لا علاقة لها بالتطبيقات (لا نفتح شيئًا، أو على الأقل لا ننفّذ دون تأكيد) =====
const negatives = ['ازيك عامل ايه', 'اهلا وسهلا', 'ما هو الطقس اليوم في القاهرة', 'افتح لعبة الشطرنج', 'احجزلي تذكرة طيران', 'كام الساعة دلوقتي', 'what is the weather', 'tell me a joke', 'افتح برنامج الحسابات', 'افتح'];
let failed6 = 0;
for (const cmd of negatives) {
  for (const [label, list] of [['القائمة الجاهزة', KNOWN_LIST], ['قائمة التطبيقات الأجنبية', bridgeApps]]) {
    const r = understand(cmd, list, []);
    const ok = !r || !r.confident;
    if (!ok) failed6++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} | [${label}] "${cmd}" -> ${r ? `${r.app.name} (${r.score.toFixed(2)}, ${r.confident ? 'فوري!' : 'تأكيد'})` : 'لم يفهم'}`);
  }
}
console.log(`\n${negatives.length * 2 - failed6}/${negatives.length * 2} نجحت (منع الفتح الخاطئ)`);

// ===== الأوامر المخصصة تتحمل اختلاف النطق =====
let failed7 = 0;
{
  const farm = [{ phrase: 'كلاش اوف كلانس', pkg: 'x.coc', name: 'Clash of Clans' }];
  const list = buildApps([{ name: 'Clash of Clans', pkg: 'x.coc' }, { name: 'Camera', pkg: 'x.camera' }]);
  for (const [cmd, wantApp] of [['افتح كلاش اوف كلانس', 'Clash of Clans'], ['افتح كلاش اف كلانز', 'Clash of Clans'], ['افتح كاميرا', 'Camera']]) {
    const r = understand(cmd, list, farm);
    const ok = !!r && r.app.name === wantApp;
    if (!ok) failed7++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} | مخصص: "${cmd}" -> ${r ? r.app.name + (r.custom ? ' (مخصص)' : '') : null}`);
  }
}

// ===== التصويت بين صيغ التعرف الصوتي =====
{
  const { understandBest } = require('./matcher');
  const alt = [
    // [الصيغ بالترتيب, التطبيق المتوقع, فوري؟]
    [['افتح سبوتفاي', 'افتح سبوتيفاي'], 'Spotify', true],
    [['افتح سبوتي قاي', 'افتح سبوتيفاي', 'افتح سبوتفاي'], 'Spotify', undefined],     // الأولى مشوّهة والباقي يتفق
    [['كلام فارغ تماما', 'افتح نتفليكس', 'افتح نتفلكس'], 'Netflix', undefined],
    [['افتح كاميرا', 'افتح ساعة'], 'Camera', true],                                  // الأولى واثقة تُنفَّذ
  ];
  for (const [cmds, expected, wantConfident] of alt) {
    const r = understandBest(cmds, bridgeApps, []);
    const ok = !!r && r.app.name === expected && (wantConfident === undefined || r.confident === wantConfident);
    if (!ok) failed7++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} | [${cmds.join(' | ')}] -> ${r ? r.app.name + (r.confident ? ' (فوري)' : ' (تأكيد)') : null}`);
  }
}

// ===== سرعة: 300 تطبيق × 5 صيغ صوتية =====
{
  const { understandBest } = require('./matcher');
  const many = buildApps(Array.from({ length: 300 }, (_, i) => ({ name: `App Number ${i} Studio`, pkg: `x.app${i}` })).concat([{ name: 'Spotify', pkg: 'x.spotify' }]));
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) understandBest(['افتح سبوتيفاي', 'افتح سبوتفاي', 'افتح سبوتي فاي', 'افتح سبوتيفى', 'افتح اسبوتيفاي'], many, []);
  const ms = (Date.now() - t0) / 5;
  const ok = ms < 400;
  if (!ok) failed7++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | الزمن لكل أمر صوتي (300 تطبيق): ${ms.toFixed(0)} ms`);
}

process.exit(failed || failed2 || failed3 || failed5 || failed6 || failed7 ? 1 : 0);
