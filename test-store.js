// اختبارات مخزن الأوامر (المرحلة 1): الترحيل من v1، الصيغ المتعددة، التصدير/الاستيراد، الاستخدام، والتكامل مع المطابق.
const S = require('./commandStore');
const { understand, understandBest } = require('./matcher');
const { buildApps } = require('./appList');

let failed = 0;
const check = (name, cond) => {
  if (!cond) failed++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} | ${name}`);
};

// --- ترحيل v1 → v2 دون فقد ---
const v1 = [
  { phrase: 'مزرعتي', pkg: 'com.farm', name: 'مزرعتي الذكية' },
  { phrase: 'الاخضر', pkg: 'com.whatsapp', name: 'WhatsApp' },
  { phrase: 'الشات', pkg: 'com.whatsapp', name: 'WhatsApp' },
  { phrase: 'مزرعتى', pkg: 'com.other', name: 'Other' },   // نفس الجملة (بعد التنظيف) لتطبيق آخر: الأول يفوز
  { phrase: '   ', pkg: 'com.x', name: 'X' },              // فارغ
  { pkg: 'com.y' },                                         // بلا جملة
  null, 'junk', 5,
  { phrase: 'بدون اسم', pkg: 'com.noname' },
];
const m = S.sanitizeCommands(v1);
check('الترحيل يجمع صيغ نفس التطبيق', m.find((e) => e.pkg === 'com.whatsapp').aliases.length === 2);
check('الترحيل يحافظ على الأوامر الصحيحة (3 تطبيقات)', m.length === 3 && m.map((e) => e.pkg).join() === 'com.farm,com.whatsapp,com.noname');
check('الجملة المكررة لتطبيق آخر تُتجاهل', !m.some((e) => e.pkg === 'com.other'));
check('اسم ناقص يصبح الحزمة', m.find((e) => e.pkg === 'com.noname').name === 'com.noname');
check('مدخل غير مصفوفة يعطي قائمة فارغة', S.sanitizeCommands(undefined).length === 0 && S.sanitizeCommands('x').length === 0);
check('إعادة التنقية لا تغيّر v2 (idempotent)', JSON.stringify(S.sanitizeCommands(m)) === JSON.stringify(m));

// --- إضافة وحذف الصيغ ---
let list = [];
let r = S.addAlias(list, { pkg: 'com.whatsapp', name: 'WhatsApp' }, 'الاخضر');
list = r.list;
check('إضافة أول صيغة', r.added && list.length === 1);
r = S.addAlias(list, { pkg: 'com.whatsapp', name: 'WhatsApp' }, 'الأخضر ');   // نفس الصيغة بعد التنظيف
check('صيغة مكررة لا تُضاف', !r.added && r.reason === 'exists');
r = S.addAlias(list, { pkg: 'com.whatsapp', name: 'WhatsApp' }, 'برنامج الشات');
list = r.list;
check('صيغة ثانية لنفس التطبيق', r.added && list[0].aliases.length === 2);
r = S.addAlias(list, { pkg: 'com.telegram', name: 'Telegram' }, 'الشات');       // "برنامج" حشو → الصيغة 'الشات'
list = r.list;
check('إضافة صيغة لتطبيق آخر', r.added && list.length === 2 && list[0].pkg === 'com.telegram');
r = S.addAlias(list, { pkg: 'com.telegram', name: 'Telegram' }, 'الاخضر');      // موجودة عند واتساب → تُنقل
list = r.list;
check('الصيغة المتعارضة تُنقل للأحدث', list.find((e) => e.pkg === 'com.telegram').aliases.includes('الاخضر') && !list.find((e) => e.pkg === 'com.whatsapp'));
check('الصيغ الفارغة أو حشو فقط مرفوضة', !S.addAlias(list, { pkg: 'a', name: 'a' }, 'افتح').added && !S.addAlias(list, { pkg: 'a', name: 'a' }, '').added);
list = S.removeAlias(list, 'com.telegram', 'الاخضر');
check('حذف صيغة واحدة', list.find((e) => e.pkg === 'com.telegram').aliases.length === 1);
list = S.removeAlias(list, 'com.telegram', 'الشات');
check('حذف آخر صيغة يزيل التطبيق', list.length === 0);
check('removeApp', S.removeApp([{ pkg: 'a', name: 'a', aliases: ['س'] }, { pkg: 'b', name: 'b', aliases: ['ص'] }], 'a').length === 1);

// --- تصدير ثم استيراد (ذهاب وعودة) ---
const base = S.sanitizeCommands([{ phrase: 'مزرعتي', pkg: 'com.farm', name: 'مزرعتي الذكية' }, { phrase: 'الاخضر', pkg: 'com.whatsapp', name: 'WhatsApp' }, { phrase: 'الشات', pkg: 'com.whatsapp', name: 'WhatsApp' }]);
const json = S.exportJson(base);
const parsed = S.parseImport(json);
check('التصدير ثم الاستيراد يعيد نفس الأوامر', parsed.ok && JSON.stringify(parsed.commands) === JSON.stringify(base));
const merged = S.mergeImport([], parsed.commands);
check('الدمج في قائمة فارغة يضيف الكل', merged.added === 3 && merged.skipped === 0 && S.countAliases(merged.list) === 3);
const merged2 = S.mergeImport(merged.list, parsed.commands);
check('الاستيراد مرتين لا يكرر شيئًا', merged2.added === 0 && S.countAliases(merged2.list) === 3);
const local = S.sanitizeCommands([{ phrase: 'الاخضر', pkg: 'com.telegram', name: 'Telegram' }]);
const merged3 = S.mergeImport(local, parsed.commands);
check('التعارض: أوامري الحالية تبقى ولا تُسرق', merged3.skipped === 1 && merged3.list.find((e) => e.pkg === 'com.telegram').aliases.includes('الاخضر'));
check('استيراد نص v1 قديم', S.parseImport(JSON.stringify(v1)).ok);
check('استيراد مصفوفة مباشرة', S.parseImport(JSON.stringify(base)).ok);
check('نص تالف يعطي خطأ مفهومًا', !S.parseImport('{bad json').ok && !!S.parseImport('{bad json').error);
check('نص فاضٍ أو بلا أوامر يرفض', !S.parseImport('').ok && !S.parseImport('{"commands":[]}').ok && !S.parseImport('[1,2]').ok);

// --- الاستخدام ---
let u = S.sanitizeUsage(undefined);
check('استخدام فارغ سليم', Object.keys(u.counts).length === 0 && u.recent.length === 0);
for (let i = 0; i < 12; i++) u = S.recordUse(u, `p${i}`);
u = S.recordUse(u, 'p3');
u = S.recordUse(u, 'p3');
check('آخر 10 فقط وبلا تكرار والأحدث أولًا', u.recent.length === 10 && u.recent[0] === 'p3' && new Set(u.recent).size === 10);
check('العدّاد يزيد', u.counts.p3 === 3 && u.counts.p0 === 1);
check('الأكثر استخدامًا', S.topUsed(u, 3)[0] === 'p3');
check('ترتيب مستقر حسب الاستخدام', S.sortByUsage([{ pkg: 'a' }, { pkg: 'p3' }, { pkg: 'b' }], u).map((x) => x.pkg).join() === 'p3,a,b');
check('تنقية استخدام تالف', S.sanitizeUsage({ counts: { a: 'x', b: 2, c: -1 }, recent: [1, 'z', 'z'] }).recent.join() === 'z');

// --- التكامل مع المطابق: الصيغ المتعددة تعمل ---
const apps = buildApps([{ name: 'WhatsApp', pkg: 'com.whatsapp' }, { name: 'Telegram', pkg: 'com.telegram' }, { name: 'مزرعتي الذكية', pkg: 'com.farm' }]);
const cust = S.sanitizeCommands([{ pkg: 'com.whatsapp', name: 'WhatsApp', aliases: ['الاخضر', 'برنامج الشات'] }]);
let t = understand('افتح الاخضر', apps, cust);
check('الصيغة الأولى تفتح', !!t && t.app.pkg === 'com.whatsapp' && t.custom && t.confident);
t = understand('شغللي الشات', apps, cust);
check('الصيغة الثانية تفتح (حشو "برنامج" لا يؤثر)', !!t && t.app.pkg === 'com.whatsapp' && t.custom);
t = understand('افتح الاخضرر', apps, cust);
check('نطق قريب من الصيغة يفتح', !!t && t.app.pkg === 'com.whatsapp');
t = understandBest(['افتح الاخضر'], apps, cust);
check('understandBest مع الصيغ المتعددة', !!t && t.app.pkg === 'com.whatsapp' && t.confident);


// --- سيناريوهات التعلّم: "تقصد أيهما؟" ثم اختيار المستخدم يصبح صيغة محفوظة ---
{
  const google = buildApps([{ name: 'Google Maps', pkg: 'com.maps' }, { name: 'Google Photos', pkg: 'com.photos' }]);
  const first = understand('افتح جوجل', google, []);
  check('الأمر الغامض يرجع مرشحين متعددين', !!first && first.ambiguous && !first.confident && [first.app, ...first.others].length === 2);
  const usageP = S.recordUse(S.recordUse(S.recordUse(undefined, 'com.photos'), 'com.photos'), 'com.maps');
  const ordered = S.sortByUsage([first.app, ...first.others], usageP);
  check('الأكثر استخدامًا يظهر أولًا في الاختيار', ordered[0].pkg === 'com.photos');
  // المستخدم يضغط Photos: نحفظ الصيغة (نفس منطق learnFrom في App.js)
  const learned = S.addAlias([], ordered[0], 'جوجل');
  const again = understand('افتح جوجل', google, learned.list);
  check('بعد الاختيار يفتح مباشرة وبثقة', learned.added && !!again && again.app.pkg === 'com.photos' && again.confident && again.custom);

  const wa = buildApps([{ name: 'WhatsApp', pkg: 'com.whatsapp' }]);
  const unsure = understand('افتح مقاطع واتساب', wa, []);
  check('فهم غير مؤكد (كلمة زائدة) يطلب تأكيدًا', !!unsure && !unsure.confident && unsure.app.pkg === 'com.whatsapp');
  const clean = require('./matcher').tokens('افتح مقاطع واتساب').join(' ');
  const l2 = S.addAlias([], unsure.app, clean);
  const next = understand('افتح مقاطع واتساب', wa, l2.list);
  check('بعد التأكيد تُحفظ الصيغة النظيفة وتفتح فورًا', l2.added && next.custom && next.confident);

  // لا نتعلّم ما يفهمه التطبيق أصلًا (منع تكدّس الصيغ)
  const known = understand('افتح واتساب', wa, []);
  check('الأمر المفهوم أصلًا لا يُحفظ كصيغة', known.confident && known.app.pkg === 'com.whatsapp');
}

console.log(failed ? `\n${failed} فشل` : '\nكل اختبارات المخزن نجحت');
process.exit(failed ? 1 : 0);
