// منطق فهم الأوامر: يحوّل جملة مثل "افتحلي الواتس" إلى تطبيق معيّن.
// بدون إنترنت وبدون أي مكتبات — مجرد تنظيف للنص ومقارنة تقريبية.

const KNOWN = require('./apps');

// كلمات الأمر التي نتجاهلها (تظهر بعد التنظيف)
const NOISE = new Set([
  'افتح', 'افتحلي', 'افتحي', 'افتحو', 'شغل', 'شغلي', 'شغللي', 'شغلو', 'طلعلي', 'روح', 'وديني', 'ودي',
  'عايز', 'عاوز', 'عايزه', 'اريد', 'ابغي', 'ابي', 'ابغا', 'محتاج', 'نفسي', 'ممكن', 'لو', 'سمحت',
  'من', 'فضلك', 'يا', 'لي', 'لا', 'علي', 'الي', 'على', 'الى', 'في', 'ف', 'عشان', 'تطبيق', 'برنامج', 'اب',
  'التطبيق', 'البرنامج', 'خلي', 'خليني', 'دخلني', 'ادخل', 'اعمل', 'هات', 'هاتلي', 'جيب', 'جيبلي',
  'open', 'launch', 'start', 'run', 'please', 'app', 'the', 'me', 'to', 'go',
]);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // تشكيل وتطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئ]/g, 'ي')
    .replace(/[پ]/g, 'ب')
    .replace(/[چ]/g, 'ج')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripArticle(token) {
  return token.length > 3 && token.startsWith('ال') ? token.slice(2) : token;
}

function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .map(stripArticle)
    .filter((t) => !NOISE.has(t));
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

// درجة تطابق تطبيق واحد مع الأمر (0 إلى 1)
// يرجع { score, kind, covered }:
//   kind: exact (تطابق تام) | contains (كل كلمات الاسم في الجملة) | subset (الجملة جزء من اسم أطول) | fuzzy (تقريب إملائي)
//   covered: هل كل كلمات الأمر مفسَّرة بالاسم؟ لو فيه كلمة زائدة (مثل "ميوزيك") لا نعتبر الفهم مؤكدًا.
function scoreApp(app, queryTokens) {
  const query = queryTokens.join(' ');
  let best = { score: 0, kind: null, covered: false };
  const consider = (score, kind, covered) => {
    if (score > best.score) best = { score, kind, covered };
  };
  for (const alias of app.aliases) {
    const aliasTokens = tokens(alias);
    if (!aliasTokens.length) continue;
    const aliasText = aliasTokens.join(' ');

    if (aliasText === query) {
      consider(1, 'exact', true);
      continue;
    }
    if (aliasTokens.every((t) => queryTokens.includes(t))) {
      // كل كلمات الاسم موجودة؛ نفضّل الاسم الذي يغطي أكبر جزء من الجملة
      const covered = queryTokens.every((t) => aliasTokens.includes(t));
      consider(0.9 + 0.1 * (aliasText.length / Math.max(query.length, aliasText.length)), 'contains', covered);
      continue;
    }
    // كلمات الأمر كلها جزء من اسم أطول (مثال: "maps" داخل "Google Maps")
    if (query.length >= 3 && queryTokens.every((t) => aliasTokens.includes(t))) {
      consider(0.75 + 0.1 * (query.length / aliasText.length), 'subset', true);
    }
    // تقريب للأخطاء الإملائية، كلمة بكلمة
    let fuzzy = 0;
    if (aliasTokens.length === 1) {
      for (const t of queryTokens) fuzzy = Math.max(fuzzy, similarity(t, aliasTokens[0]));
    } else {
      fuzzy = similarity(query, aliasText);
    }
    // نرفض التشابه الضعيف، ونقلل قيمة التقريب عن التطابق الحقيقي
    if (fuzzy >= 0.72) consider(fuzzy * 0.88, 'fuzzy', false);
  }
  return best;
}

// أمر أضافه المستخدم: { phrase, pkg, name }. له الأولوية على أي مطابقة تلقائية.
function matchCustom(queryTokens, custom) {
  let best = null;
  for (const entry of custom) {
    const pt = tokens(entry.phrase);
    if (!pt.length) continue;
    if (pt.every((t) => queryTokens.includes(t))) {
      if (!best || pt.length > best.len) best = { entry, len: pt.length };
    }
  }
  return best && best.entry;
}

// apps: [{ name, pkg, aliases }]  |  custom: [{ phrase, pkg, name }]
// يرجع { app, score, ambiguous, confident, others, custom } أو null لو لم يفهم
//   confident = true  → ننفّذ فورًا.
//   confident = false → نعرض الفهم ونطلب تأكيدًا (غامض، أو تقريب إملائي، أو فيه كلمة زائدة لم تُفهم).
function understand(command, apps = KNOWN, custom = []) {
  const q = tokens(command);
  if (!q.length) return null;

  const hit = matchCustom(q, custom);
  if (hit) {
    const app = apps.find((a) => a.pkg === hit.pkg) || { name: hit.name || hit.pkg, pkg: hit.pkg, aliases: [] };
    return { app, score: 2, ambiguous: false, confident: true, others: [], custom: true };
  }

  const scored = apps
    .map((app) => ({ app, ...scoreApp(app, q) }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const [top, ...rest] = scored;
  // لو أول نتيجتين قريبتين جدًا نعتبر الأمر غامضًا
  const ambiguous = rest.length > 0 && top.score - rest[0].score < 0.05 && top.score < 0.95;
  // الجزئي (subset) والتقريب الإملائي (fuzzy) دائمًا يحتاجان تأكيدًا: كلمة مثل "جوجل" قد تخص أكثر من تطبيق.
  const confident = !ambiguous && top.covered && (top.kind === 'exact' || top.kind === 'contains');
  return { app: top.app, score: top.score, ambiguous, confident, others: rest.slice(0, 3).map((x) => x.app), custom: false };
}

// للصوت: المتعرّف يرجّع عدة صيغ محتملة للجملة. نعتمد الصيغة الأولى،
// ولا نرفع الثقة إلا لو صيغة أخرى أكدت نفس التطبيق بثقة (اتفاق)، منعًا لفتح تطبيق خاطئ من صيغة عشوائية.
function understandBest(commands, apps = KNOWN, custom = []) {
  const results = commands.map((c) => understand(c, apps, custom));
  const first = results.findIndex(Boolean);
  if (first < 0) return null;
  const top = results[first];
  if (first > 0) return { ...top, confident: false }; // الصيغة الأولى لم تُفهم: لا ننفّذ من صيغة بديلة دون تأكيد
  if (top.confident) return top;
  if (!top.ambiguous) {
    const agree = results.some((r) => r && r.confident && r.app.pkg === top.app.pkg);
    if (agree) return { ...top, confident: true };
  }
  return top;
}

module.exports = { understand, understandBest, normalize, tokens };
