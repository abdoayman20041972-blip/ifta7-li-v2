// اختبارات أوامر الجهاز (القاموس المغلق) — node test-device.js
const { matchDeviceCommand } = require('./deviceCommands');

let pass = 0;
let fail = 0;

function ok(desc, text, expected) {
  const got = matchDeviceCommand(text);
  const same = JSON.stringify(got) === JSON.stringify(expected);
  if (same) {
    pass++;
    console.log(`OK   | ${desc}`);
  } else {
    fail++;
    console.log(`FAIL | ${desc} => ${JSON.stringify(got)} (المتوقع ${JSON.stringify(expected)})`);
  }
}

// ===== الكشاف: إشعال =====
ok('نوّر الكشاف → إشعال', 'نور الكشاف', { type: 'torch', on: true });
ok('شغل الكشاف → إشعال', 'شغل الكشاف', { type: 'torch', on: true });
ok('افتح الكشاف → إشعال', 'افتح الكشاف', { type: 'torch', on: true });
ok('ضوّي الكشاف → إشعال', 'ضوي الكشاف', { type: 'torch', on: true });
ok('ولّع الكشاف → إشعال', 'ولع الكشاف', { type: 'torch', on: true });
ok('الكشاف وحده → إشعال', 'الكشاف', { type: 'torch', on: true });
ok('كشاف → إشعال', 'كشاف', { type: 'torch', on: true });
ok('شغل النور → إشعال', 'شغل النور', { type: 'torch', on: true });
ok('شغل اللمبة → إشعال', 'شغل اللمبة', { type: 'torch', on: true });
ok('افتحلي الكشاف → إشعال', 'افتحلي الكشاف', { type: 'torch', on: true });

// ===== الكشاف: إطفاء =====
ok('اقفل الكشاف → إطفاء', 'اقفل الكشاف', { type: 'torch', on: false });
ok('اطفي الكشاف → إطفاء', 'اطفي الكشاف', { type: 'torch', on: false });
ok('اطفي النور → إطفاء', 'اطفي النور', { type: 'torch', on: false });
ok('اقفل الضوء → إطفاء', 'اقفل الضوء', { type: 'torch', on: false });
ok('شيل اللمبة → إطفاء', 'شيل اللمبة', { type: 'torch', on: false });
ok('قفل الكشاف → إطفاء', 'قفل الكشاف', { type: 'torch', on: false });

// ===== آخر تطبيق =====
ok('افتح آخر واحد → آخر تطبيق', 'افتح آخر واحد', { type: 'last' });
ok('افتح الاخير → آخر تطبيق', 'افتح الأخير', { type: 'last' });
ok('افتح اللي فات → آخر تطبيق', 'افتح اللي فات', { type: 'last' });
ok('افتح الآخر → آخر تطبيق', 'افتح الآخر', { type: 'last' });
ok('اخر واحد → آخر تطبيق', 'اخر واحد', { type: 'last' });

// ===== إعدادات الجهاز (المرحلة 5) =====
ok('افتح الواي فاي → إعدادات واي فاي', 'افتح الواي فاي', { type: 'settings', target: 'wifi' });
ok('شغل الوافي → إعدادات واي فاي', 'شغل الوافي', { type: 'settings', target: 'wifi' });
ok('اقفل الواي فاي → إعدادات واي فاي (الإغلاق ممنوع برمجيًا فنفتح)', 'اقفل الواي فاي', { type: 'settings', target: 'wifi' });
ok('شغل النت → إعدادات واي فاي (لوحة الاتصال)', 'شغل النت', { type: 'settings', target: 'wifi' });
ok('شغل الداتا → إعدادات واي فاي', 'شغل الداتا', { type: 'settings', target: 'wifi' });
ok('واي فاي وحدها → إعدادات واي فاي', 'واي فاي', { type: 'settings', target: 'wifi' });
ok('افتح البلوتوث → إعدادات بلوتوث', 'افتح البلوتوث', { type: 'settings', target: 'bluetooth' });
ok('بلوتوث وحدها → إعدادات بلوتوث', 'بلوتوث', { type: 'settings', target: 'bluetooth' });
ok('شغل البلوتوت → إعدادات بلوتوث', 'شغل البلوتوت', { type: 'settings', target: 'bluetooth' });
ok('افتح وضع الطيران → إعدادات طيران', 'افتح وضع الطيران', { type: 'settings', target: 'airplane' });
ok('الطيران وحدها → إعدادات طيران', 'الطيران', { type: 'settings', target: 'airplane' });

// ===== سالبة: تُرك لمطابِق التطبيقات =====
ok('افتح واتساب → ليس أمر جهاز', 'افتح واتساب', null);
ok('افتح بلوتوث بلاي → كلمة زائدة تُرك للتطبيقات', 'افتح بلوتوث بلاي', null);
ok('افتح اخبار النت → كلمة زائدة', 'افتح اخبار النت', null);
ok('شبكات النت المتاحة → كلمات زائدة', 'شبكات النت المتاحة', null);
ok('افتح الكاميرا → ليس أمر جهاز', 'افتح الكاميرا', null);
ok('افتح ساعة النور → كلمة زائدة تُرك للتطبيقات', 'افتح ساعة النور', null);
ok('شغل أغنية نور → كلمة زائدة', 'شغل أغنية النور', null);
ok('افتح اخبار اليوم → «اخر» غير موجودة', 'افتح اخبار اليوم', null);
ok('جملة طويلة → ليست أمر جهاز', 'من فضلك يا سيد لو سمحت افتح لي الكشاف الآن', null);
ok('جملة فاضية → لا شيء', '', null);
ok('تعارض أفعال → غامضة تتجاهل', 'شغل واقفل الكشاف', null);

console.log('');
console.log(`النتيجة: نجح ${pass} / فشل ${fail}`);
process.exit(fail ? 1 : 0);
