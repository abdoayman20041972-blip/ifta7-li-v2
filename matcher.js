// منطق فهم الأوامر: يحوّل جملة مثل "افتحلي الواتس" أو "فودافون" أو "open camera" إلى تطبيق معيّن.
// بدون إنترنت وبدون أي مكتبات — تنظيف للنص + جسر صوتي بين العربي والإنجليزي + مقارنة تقريبية.
//
// الإصدار 2 (المرحلة 0): ما الجديد؟
//   1. جسر صوتي: "فودافون" ≈ Vodafone و "سبوتيفاي" ≈ Spotify (هيكل حروف ساكنة موحّد للغتين).
//   2. قاموس مرادفات (synonyms.js): كاميرا = Camera، حاسبة = Calculator...
//   3. تنظيف أذكى: بادئات (بالواتس، للواتس، والواتس) وأفعال الأمر بلهجات مختلفة (افتحلي، شغّلها، وريني...).
//   4. مقارنة كلمة بكلمة مع تقريب إملائي + تبديل حروف + بادئة (واتس ← واتساب) + تشابه مقاطع.
//   5. تصويت بين صيغ التعرف الصوتي بدل مجرد "الاتفاق".
//   6. أوامر المستخدم المخصصة تتحمل أخطاء النطق أيضًا.

const KNOWN = require('./apps');
const SYNONYMS = require('./synonyms');

// ===== إعدادات يمكن ضبطها =====
const CFG = {
  pairMin: 0.72,        // أدنى تشابه لاعتبار كلمتين متقابلتين
  listMin: 0.6,         // أدنى درجة لظهور تطبيق كمرشَّح
  coverBonus: 0.08,     // أفضلية للتطبيق الذي يفسّر كل كلمات الأمر على من ترك كلمة بلا تفسير
  ambiguousMargin: 0.06,// الفارق الأدنى بين الأول والثاني لنعتبر الفهم غير غامض
  fuzzyConfident: 0.9,  // أدنى درجة لتنفيذ فوري بالجسر الصوتي (بين لغتين)
  fuzzyMargin: 0.06,    // الفارق الأدنى عن الثاني لهذا التنفيذ الفوري
  customFuzzyMin: 0.85, // أدنى درجة لقبول أمر مخصص نُطق بشكل مختلف قليلًا
};

// كلمات الأمر التي نتجاهلها (تظهر بعد التنظيف)
const NOISE = new Set([
  'افتح', 'افتحلي', 'افتحي', 'افتحو', 'شغل', 'شغلي', 'شغللي', 'شغلو', 'طلعلي', 'روح', 'وديني', 'ودي',
  'عايز', 'عاوز', 'عايزه', 'اريد', 'ابغي', 'ابي', 'ابغا', 'محتاج', 'نفسي', 'ممكن', 'لو', 'سمحت',
  'من', 'فضلك', 'يا', 'لي', 'لا', 'علي', 'الي', 'على', 'الى', 'في', 'ف', 'عشان', 'تطبيق', 'برنامج', 'اب',
  'التطبيق', 'البرنامج', 'خلي', 'خليني', 'دخلني', 'ادخل', 'اعمل', 'هات', 'هاتلي', 'جيب', 'جيبلي',
  // لهجات وكلمات حشو إضافية
  'الو', 'هاي', 'طب', 'بقي', 'دلوقتي', 'الان', 'حالا', 'بسرعه', 'كمان', 'تاني', 'شويه', 'معلش', 'يلا', 'بس',
  'اوبن', 'ستارت', 'لانش', 'رن', 'وريني', 'ورني', 'شوفلي', 'انا', 'عاوزه', 'عايزين', 'عاوزين', 'لحظه',
  'open', 'launch', 'start', 'run', 'please', 'app', 'the', 'me', 'to', 'go',
  'can', 'you', 'could', 'would', 'i', 'want', 'need', 'like', 'my', 'for', 'show', 'hey', 'ok', 'okay', 'now', 'application',
]);

// أفعال الأمر الملتصقة بضمائر (افتحلي، افتحها، شغلهالي، دخّلني...) — تُعتبر حشوًا.
const VERB_STEMS = [
  'افتح', 'فتح', 'شغل', 'روح', 'ودي', 'طلع', 'اطلع', 'هات', 'جيب', 'خل', 'دخل', 'ادخل', 'اعمل',
  'عايز', 'عاوز', 'اريد', 'ابغ', 'ابي', 'محتاج', 'وريني', 'ورني', 'شوف', 'رن',
];
const VERB_SUFFIXES = new Set(['', 'ي', 'لي', 'ني', 'لنا', 'ها', 'ه', 'هم', 'ك', 'ولي', 'يلي', 'ليا', 'ه', 'وا', 'و', 'هالي', 'هاليا', 'يني', 'ينا', 'ه']);
function isStemWord(t) {
  for (const stem of VERB_STEMS) {
    if (t.startsWith(stem) && VERB_SUFFIXES.has(t.slice(stem.length))) return true;
  }
  return false;
}
// يشمل المضارع: تفتحلي، تشغلها، يفتح، نفتح... (حرف المضارعة + الجذر)
function isCommandWord(t) {
  return isStemWord(t) || (t.length > 3 && 'تنيب'.includes(t[0]) && isStemWord(t.slice(1)));
}

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
  if (token.length > 4 && token.startsWith('لل')) return token.slice(2); // للواتس ← واتس
  return token.length > 3 && token.startsWith('ال') ? token.slice(2) : token;
}

function tokens(text) {
  return normalize(text)
    .split(' ')
    .filter(Boolean)
    .map(stripArticle)
    .filter((t) => !NOISE.has(t) && !isCommandWord(t));
}

// ===== مقارنة نصية =====

// Damerau-Levenshtein (يحتسب تبديل حرفين متجاورين كخطأ واحد)
function damerau(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

function dice(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, c] of ga) inter += Math.min(c, gb.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

function surfaceSim(a, b) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  let s = 1 - damerau(a, b) / longest;
  if (longest >= 5) s = Math.max(s, dice(a, b) * 0.92);
  return s;
}

// ===== الجسر الصوتي: هيكل الحروف الساكنة =====
// نحوّل أي كلمة (عربية أو لاتينية) إلى سلسلة حروف ساكنة موحّدة؛ حروف العلة تُحذف لأن الكتابة العربية لا تكتبها أصلًا.
const AR_MAP = {
  ب: 'b', ت: 't', ث: 's', ج: 'g', ح: 'h', خ: 'k', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'x',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h',
  ڤ: 'f', گ: 'g',
};
const LAT_KEEP = new Set('btdfghklmnrszx'.split(''));
const skMemo = new Map();

function skeleton(word) {
  if (skMemo.has(word)) return skMemo.get(word);
  let w = String(word).replace(/(.)\1+/g, '$1'); // تكرار الحرف (pp, oo, وو) حرف واحد
  const hasAr = /[\u0600-\u06FF]/.test(w);
  let out = '';
  if (hasAr) {
    for (let i = 0; i < w.length; i++) {
      const ch = w[i];
      if (AR_MAP[ch]) {
        if (ch === 'ه' && i === w.length - 1 && w.length > 2) continue; // ه في آخر الكلمة غالبًا حركة (ة)
        out += AR_MAP[ch];
      } else if ((ch === 'و' || ch === 'ي') && i === 0) out += ch === 'و' ? 'w' : 'y';
      else if (LAT_KEEP.has(ch)) out += ch;
    }
  } else {
    w = w
      .replace(/x/g, 'ks')
      .replace(/ph/g, 'f')
      .replace(/chr/g, 'kr')
      .replace(/sh|ch/g, 'x')
      .replace(/kh|ck|q/g, 'k')
      .replace(/th/g, 't')
      .replace(/wh/g, 'w')
      .replace(/gh/g, 'g')
      .replace(/c(?=[eiy])/g, 's')
      .replace(/c/g, 'k')
      .replace(/j/g, 'g')
      .replace(/v/g, 'f')
      .replace(/p/g, 'b');
    for (let i = 0; i < w.length; i++) {
      const ch = w[i];
      if (LAT_KEEP.has(ch)) out += ch;
      else if ((ch === 'w' || ch === 'y') && i === 0) out += ch;
    }
  }
  skMemo.set(word, out);
  return out;
}

// حروف متقاربة في النطق: استبدالها بينها خطأ "خفيف" (كلفة 0.4 بدل 1)
const CONFUSABLE = [['k', 'g'], ['s', 'z'], ['t', 'd'], ['s', 'x']];
function subCost(a, b) {
  if (a === b) return 0;
  for (const [p, q] of CONFUSABLE) if ((a === p && b === q) || (a === q && b === p)) return 0.4;
  return 1;
}
function weightedLev(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + subCost(a[i - 1], b[j - 1]));
    }
    prev = cur;
  }
  return prev[n];
}
function skeletonSim(sa, sb) {
  if (!sa || !sb) return 0;
  const longest = Math.max(sa.length, sb.length);
  let s = 1 - weightedLev(sa, sb) / longest;
  if (Math.min(sa.length, sb.length) < 3) s = sa === sb ? 0.76 : s * 0.7; // هياكل قصيرة جدًا (مثل زوم/Zoom): دليل ضعيف، يحتاج تأكيدًا
  return s;
}

const isAr = (t) => /[\u0600-\u06FF]/.test(t);

// ===== المرادفات =====
const SYN = SYNONYMS.map((g) => g.map((f) => tokens(f).join(' ')).filter(Boolean));
const SYN_MAP = new Map();
SYN.forEach((g, i) => g.forEach((f) => { if (!SYN_MAP.has(f)) SYN_MAP.set(f, i); }));

const variantCache = new WeakMap();
// الصيغ المعتمدة لكل تطبيق: أسماؤه + مرادفاتها (بدرجة أقل قليلًا حتى يتقدم الاسم الأصلي عند التعادل)
function aliasVariants(app) {
  let v = variantCache.get(app);
  if (v) return v;
  const seen = new Map();
  const add = (text, w) => {
    const k = tokens(text).join(' ');
    if (!k) return;
    if (!seen.has(k) || seen.get(k) < w) seen.set(k, w);
  };
  for (const al of app.aliases || []) {
    add(al, 1);
    const aT = tokens(al);
    const gi = SYN_MAP.get(aT.join(' '));
    if (gi != null) SYN[gi].forEach((f) => add(f, 0.97));
    if (aT.length > 1) {
      aT.forEach((t, i) => {
        const g = SYN_MAP.get(t);
        if (g == null) return;
        SYN[g].forEach((f) => {
          if (f === t) return;
          const c = aT.slice();
          c[i] = f;
          add(c.join(' '), 0.95);
        });
      });
    }
  }
  v = [...seen].map(([text, w]) => ({ text, w }));
  variantCache.set(app, v);
  return v;
}

// صيغ الكلمة بعد نزع بادئات العطف والجر: بالواتس، والواتس، كالواتس، فواتس...
function variants(t) {
  const out = [[t, 1]];
  if (t.length >= 6 && /^[وفبكل]ال/.test(t)) out.push([t.slice(3), 0.96]);
  if (t.length >= 4 && /^[وفبكل]/.test(t)) out.push([t.slice(1), 0.94]);
  return out;
}

// تشابه كلمة من الأمر (q) مع كلمة من اسم التطبيق (a). يرجع { s, cross }
function tokSim(q, a, aSk) {
  if (q === a) return { s: 1, cross: false };
  let best = { s: 0, cross: false };
  const crossScript = isAr(q) !== isAr(a);
  for (const [v, w] of variants(q)) {
    if (v === a) {
      if (w > best.s) best = { s: w, cross: false };
      continue;
    }
    if (v.length < 2 || a.length < 2) continue;
    let surf = 0;
    if (Math.min(v.length, a.length) >= 3 && !crossScript) {
      surf = surfaceSim(v, a);
      if (a.startsWith(v) || v.startsWith(a)) {
        surf = Math.max(surf, 0.85 + (0.1 * Math.min(v.length, a.length)) / Math.max(v.length, a.length));
      }
    }
    const ph = 0.97 * skeletonSim(skeleton(v), aSk);
    const s = Math.max(surf, ph) * w;
    if (s > best.s) best = { s, cross: crossScript && ph >= surf };
  }
  return best;
}

// محاذاة كلمات الأمر مع كلمات اسم التطبيق
function align(qTokens, aTokens) {
  const aSk = aTokens.map(skeleton);
  const pairs = [];
  qTokens.forEach((q, i) => aTokens.forEach((a, j) => {
    const r = tokSim(q, a, aSk[j]);
    if (r.s >= CFG.pairMin) pairs.push({ s: r.s, cross: r.cross, i, j });
  }));
  pairs.sort((x, y) => y.s - x.s);
  const usedQ = new Set();
  const usedA = new Set();
  let sum = 0;
  let n = 0;
  let crossPairs = 0;
  let sameInexact = 0;
  for (const p of pairs) {
    if (usedQ.has(p.i) || usedA.has(p.j)) continue;
    usedQ.add(p.i);
    usedA.add(p.j);
    sum += p.s;
    n++;
    if (p.s < 1) (p.cross ? crossPairs++ : sameInexact++);
  }
  const qCov = usedQ.size / qTokens.length;
  const aCov = usedA.size / aTokens.length;
  const avg = n ? sum / n : 0;
  const score = avg * (0.5 + 0.5 * qCov) * (0.85 + 0.15 * aCov);
  return { score, qCov, aCov, cross: crossPairs > 0 && sameInexact === 0 };
}

// درجة تطابق تطبيق واحد مع الأمر (0 إلى 1)
// يرجع { score, kind, covered, aCov, cross }:
//   kind: exact | contains | subset | fuzzy
//   covered: هل كل كلمات الأمر مفسَّرة بالاسم؟ لو فيه كلمة زائدة (مثل "ميوزيك") لا نعتبر الفهم مؤكدًا.
//   aCov: نسبة كلمات اسم التطبيق التي ذُكرت في الأمر (أقل من 1 = الأمر جزء من اسم أطول).
//   cross: الفهم جاء من الجسر الصوتي بين لغتين وليس من تقريب إملائي داخل اللغة نفسها.
function scoreApp(app, queryTokens) {
  const query = queryTokens.join(' ');
  let best = { score: 0, kind: null, covered: false, aCov: 1, cross: false };
  let sameBest = 0; // أفضل دليل من نفس لغة الأمر (لتمييز خطأ إملائي عن تطابق بين لغتين)
  let isOriginal = true; // الأدلة المشتقة من المرادفات لا تُحسب كدليل "نفس اللغة"
  const consider = (score, kind, covered, aCov = 1, cross = false) => {
    if (!cross && isOriginal) sameBest = Math.max(sameBest, score);
    if (score > best.score) best = { score, kind, covered, aCov, cross };
  };
  for (const { text: aliasText, w } of aliasVariants(app)) {
    const aliasTokens = aliasText.split(' ');
    isOriginal = w === 1;

    if (aliasText === query) {
      consider(w, 'exact', true);
      continue;
    }
    if (aliasTokens.every((t) => queryTokens.includes(t))) {
      // كل كلمات الاسم موجودة؛ نفضّل الاسم الذي يغطي أكبر جزء من الجملة
      const covered = queryTokens.every((t) => aliasTokens.includes(t));
      consider(w * (0.9 + 0.1 * (aliasText.length / Math.max(query.length, aliasText.length))), 'contains', covered);
      continue;
    }
    if (query.length >= 3 && queryTokens.every((t) => aliasTokens.includes(t))) {
      consider(w * (0.75 + 0.1 * (query.length / aliasText.length)), 'subset', true, 0.5);
    }
    // المحاذاة كلمة بكلمة (تقريب إملائي + جسر صوتي + بادئات)
    const al = align(queryTokens, aliasTokens);
    if (al.score > 0) consider(al.score * w, 'fuzzy', al.qCov === 1, al.aCov, al.cross);

    // مقارنة العبارة كاملة بلا مسافات: "فيس بوك" ≈ facebook، "تيك توك" ≈ tiktok
    if (queryTokens.length > 1 || aliasTokens.length > 1) {
      const qj = queryTokens.join('');
      const aj = aliasTokens.join('');
      const surf = 0.97 * surfaceSim(qj, aj);
      const ph = 0.95 * skeletonSim(queryTokens.map(skeleton).join(''), aliasTokens.map(skeleton).join(''));
      const s = Math.max(surf, ph);
      if (s >= CFG.pairMin) consider(s * w, 'fuzzy', true, 1, ph > surf + 0.05);
    }
  }
  if (best.cross && sameBest >= 0.8) best = { ...best, cross: false };
  return best;
}

// ===== الأوامر المخصصة =====
// أمر أضافه المستخدم: { phrase, pkg, name } (وأي صيغ إضافية في aliases إن وُجدت). له الأولوية على أي مطابقة تلقائية.
// التطابق التام أولًا، ثم تقريب نطقي/إملائي للجملة التي علّمها المستخدم.
function customPhrases(entry) {
  return [entry.phrase, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter((p) => typeof p === 'string');
}
function matchCustom(queryTokens, custom) {
  let exact = null;
  let fuzzy = null;
  for (const entry of custom) {
    for (const phrase of customPhrases(entry)) {
      const pt = tokens(phrase);
      if (!pt.length) continue;
      if (pt.every((t) => queryTokens.includes(t))) {
        if (!exact || pt.length > exact.len) exact = { entry, len: pt.length };
      } else {
        const al = align(queryTokens, pt);
        if (al.qCov === 1 && al.aCov === 1 && al.score >= CFG.customFuzzyMin && (!fuzzy || al.score > fuzzy.score)) {
          fuzzy = { entry, score: al.score };
        }
      }
    }
  }
  if (exact) return { entry: exact.entry, exact: true, score: 2 };
  if (fuzzy) return { entry: fuzzy.entry, exact: false, score: fuzzy.score };
  return null;
}

// apps: [{ name, pkg, aliases }]  |  custom: [{ phrase, pkg, name }]
// يرجع { app, score, ambiguous, confident, others, custom, kind } أو null لو لم يفهم
//   confident = true  → ننفّذ فورًا.
//   confident = false → نعرض الفهم ونطلب تأكيدًا (غامض، أو تقريب إملائي، أو فيه كلمة زائدة لم تُفهم).
function understand(command, apps = KNOWN, custom = []) {
  const q = tokens(command);
  if (!q.length) return null;

  const hit = matchCustom(q, custom);
  if (hit) {
    const e = hit.entry;
    const app = apps.find((a) => a.pkg === e.pkg) || { name: e.name || e.pkg, pkg: e.pkg, aliases: [] };
    return { app, score: hit.score, ambiguous: false, confident: hit.exact || hit.score >= 0.92, others: [], custom: true, kind: 'custom' };
  }

  const scored = apps
    .map((app) => ({ app, ...scoreApp(app, q) }))
    .filter((x) => x.score >= CFG.listMin)
    .map((x) => ({ ...x, adj: x.score + (x.covered ? CFG.coverBonus : 0) }))
    .sort((a, b) => b.adj - a.adj);
  if (!scored.length) return null;
  const [top, ...rest] = scored;
  const margin = rest.length ? top.adj - rest[0].adj : 1;
  // لو أول نتيجتين قريبتين جدًا نعتبر الأمر غامضًا
  const ambiguous = rest.length > 0 && margin < CFG.ambiguousMargin && top.score < 0.95;
  // التنفيذ الفوري:
  //   1) تطابق تام/كامل الاسم يفسّر كل الأمر، أو
  //   2) فهم عبر الجسر الصوتي بين لغتين بدرجة عالية وبفارق واضح، ويغطي اسم التطبيق كله (مثل: سبوتيفاي ← Spotify).
  // الجزئي (الأمر جزء من اسم أطول) والتقريب الإملائي داخل نفس اللغة يحتاجان تأكيدًا.
  const confident =
    !ambiguous &&
    top.covered &&
    (top.kind === 'exact' ||
      top.kind === 'contains' ||
      (top.kind === 'fuzzy' && top.cross && top.aCov === 1 && top.score >= CFG.fuzzyConfident && margin >= CFG.fuzzyMargin));
  return { app: top.app, score: top.score, ambiguous, confident, others: rest.slice(0, 3).map((x) => x.app), custom: false, kind: top.kind };
}

// للصوت: المتعرّف يرجّع عدة صيغ محتملة للجملة (الأولى هي الأرجح).
// - لو الصيغة الأولى مفهومة بثقة ننفّذها.
// - غير ذلك نجمع أصوات كل الصيغ: التطبيق الذي تتفق عليه صيغ أكثر (مع وزن الترتيب) يتقدم،
//   ولا نرفع الثقة إلا لو صيغتان على الأقل اتفقتا وإحداهما واثقة، منعًا لفتح تطبيق خاطئ من صيغة عشوائية.
const RANK_W = [1, 0.85, 0.7, 0.6, 0.5];
function understandBest(commands, apps = KNOWN, custom = []) {
  const results = commands.map((c) => understand(c, apps, custom));
  const first = results.findIndex(Boolean);
  if (first < 0) return null;
  if (first === 0 && results[0].confident) return results[0];

  const agg = new Map();
  results.forEach((r, i) => {
    if (!r) return;
    const value = Math.min(r.score, 1.2) * (RANK_W[i] ?? 0.4);
    const e = agg.get(r.app.pkg) || { res: r, best: 0, votes: 0, confidentVotes: 0 };
    e.votes++;
    if (r.confident) e.confidentVotes++;
    if (value > e.best) { e.best = value; e.res = r; }
    agg.set(r.app.pkg, e);
  });
  const ranked = [...agg.values()]
    .map((e) => ({ ...e, total: e.best + 0.12 * (e.votes - 1) }))
    .sort((a, b) => b.total - a.total);
  const win = ranked[0];
  const runnerUp = ranked[1];
  const clearWin = !runnerUp || win.total - runnerUp.total >= 0.05;
  const confident = clearWin && !win.res.ambiguous && win.votes >= 2 && win.confidentVotes >= 1 && first === 0
    ? true
    : clearWin && !win.res.ambiguous && win.votes >= 3 && win.confidentVotes >= 1;
  const others = [];
  for (const e of ranked.slice(1)) others.push(e.res.app);
  for (const a of win.res.others) if (!others.some((o) => o.pkg === a.pkg) && a.pkg !== win.res.app.pkg) others.push(a);
  return { ...win.res, confident, ambiguous: win.res.ambiguous || !clearWin, others: others.slice(0, 3) };
}

module.exports = { understand, understandBest, normalize, tokens, skeleton, scoreApp };
