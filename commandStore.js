// مخزن الأوامر المخصصة والإحصاءات (JS صِرف بلا أي مكتبات، قابل للاختبار بـ node).
//
// شكل البيانات الجديد (v2): التطبيق ← قائمة صيغ
//   [{ pkg: 'com.whatsapp', name: 'واتساب', aliases: ['الاخضر', 'برنامج الشات'] }, ...]
// الشكل القديم (v1) كان سجلًا لكل جملة: { phrase, pkg, name }. نقرأه ونحوّله تلقائيًا دون فقد أي أمر.

const { tokens } = require('./matcher');

const keyOf = (phrase) => tokens(phrase).join(' ');

// تنقية أي مدخل (v1 أو v2 أو مزيج، أو كائن فيه commands) إلى v2 سليم.
// الصيغة المكررة بين تطبيقين يفوز بها الأول (الأحدث في الترتيب)، فلا تتعارض صيغتان على نفس الجملة.
function sanitizeCommands(value) {
  const src = Array.isArray(value) ? value : value && Array.isArray(value.commands) ? value.commands : [];
  const byPkg = new Map();
  const seen = new Set();
  for (const x of src) {
    if (!x || typeof x !== 'object' || typeof x.pkg !== 'string' || !x.pkg) continue;
    const phrases = [];
    if (Array.isArray(x.aliases)) phrases.push(...x.aliases);
    if (typeof x.phrase === 'string') phrases.unshift(x.phrase);
    for (const raw of phrases) {
      if (typeof raw !== 'string') continue;
      const phrase = raw.trim();
      const key = keyOf(phrase);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let e = byPkg.get(x.pkg);
      if (!e) {
        e = { pkg: x.pkg, name: typeof x.name === 'string' && x.name ? x.name : x.pkg, aliases: [] };
        byPkg.set(x.pkg, e);
      }
      e.aliases.push(phrase);
    }
  }
  return [...byPkg.values()];
}

// يضيف صيغة لتطبيق. لو الصيغة موجودة عند تطبيق آخر تُنقل إلى هذا التطبيق (الأحدث يفوز).
// يرجع { list, added, reason }
function addAlias(list, app, phrase) {
  const phraseClean = String(phrase || '').trim();
  const key = keyOf(phraseClean);
  if (!key) return { list, added: false, reason: 'empty' };
  const current = list.find((e) => e.pkg === app.pkg);
  if (current && current.aliases.some((a) => keyOf(a) === key)) return { list, added: false, reason: 'exists' };
  // نزيل الصيغة من أي تطبيق آخر ثم نضيفها لهذا التطبيق في المقدمة
  const stripped = list
    .map((e) => (e.pkg === app.pkg ? e : { ...e, aliases: e.aliases.filter((a) => keyOf(a) !== key) }))
    .filter((e) => e.aliases.length > 0 || e.pkg === app.pkg);
  const base = stripped.find((e) => e.pkg === app.pkg) || { pkg: app.pkg, name: app.name || app.pkg, aliases: [] };
  const entry = { ...base, name: app.name || base.name, aliases: [...base.aliases, phraseClean] };
  return { list: [entry, ...stripped.filter((e) => e.pkg !== app.pkg)], added: true, reason: 'ok' };
}

function removeAlias(list, pkg, phrase) {
  const key = keyOf(phrase);
  return list
    .map((e) => (e.pkg === pkg ? { ...e, aliases: e.aliases.filter((a) => keyOf(a) !== key) } : e))
    .filter((e) => e.aliases.length > 0);
}

function removeApp(list, pkg) {
  return list.filter((e) => e.pkg !== pkg);
}

const countAliases = (list) => list.reduce((n, e) => n + e.aliases.length, 0);

// ===== التصدير والاستيراد =====
function exportJson(list) {
  return JSON.stringify({ app: 'ifta7li', version: 2, exportedAt: new Date().toISOString(), commands: list }, null, 2);
}

// يقرأ نصًا ملصوقًا. يرجع { ok, commands } أو { ok:false, error }
function parseImport(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'الحقل فاضي. الصق النص المنسوخ هنا.' };
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'النص ده مش صالح. تأكد إنك نسخته كامل من \"تصدير\".' };
  }
  const commands = sanitizeCommands(data);
  if (!commands.length) return { ok: false, error: 'ما لقيتش أوامر صالحة في النص.' };
  return { ok: true, commands };
}

// يدمج الأوامر المستوردة مع الحالية دون مسح شيء: الصيغة المتعارضة (لتطبيق آخر) تُتخطّى حفاظًا على أوامرك الحالية.
// يرجع { list, added, skipped }
function mergeImport(list, incoming) {
  let next = list;
  let added = 0;
  let skipped = 0;
  for (const e of incoming) {
    for (const phrase of e.aliases) {
      const key = keyOf(phrase);
      const owner = next.find((x) => x.aliases.some((a) => keyOf(a) === key));
      if (owner && owner.pkg !== e.pkg) {
        skipped++;
        continue;
      }
      const r = addAlias(next, e, phrase);
      if (r.added) {
        next = r.list;
        added++;
      }
    }
  }
  return { list: next, added, skipped };
}

// ===== الاستخدام: عدّاد لكل تطبيق + آخر 10 =====
const RECENT_MAX = 10;
function sanitizeUsage(value) {
  const counts = {};
  if (value && value.counts && typeof value.counts === 'object') {
    for (const [pkg, n] of Object.entries(value.counts)) if (typeof n === 'number' && n > 0) counts[pkg] = Math.floor(n);
  }
  const recent = Array.isArray(value && value.recent) ? value.recent.filter((p) => typeof p === 'string') : [];
  return { counts, recent: [...new Set(recent)].slice(0, RECENT_MAX) };
}
function recordUse(usage, pkg) {
  const u = sanitizeUsage(usage);
  return {
    counts: { ...u.counts, [pkg]: (u.counts[pkg] || 0) + 1 },
    recent: [pkg, ...u.recent.filter((p) => p !== pkg)].slice(0, RECENT_MAX),
  };
}
function topUsed(usage, n = 6) {
  const u = sanitizeUsage(usage);
  return Object.entries(u.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pkg]) => pkg);
}
// ترتيب مستقر: الأكثر استخدامًا أولًا، وعند التعادل يبقى الترتيب الأصلي
function sortByUsage(list, usage, pkgOf = (x) => x.pkg) {
  const u = sanitizeUsage(usage);
  return list.map((x, i) => ({ x, i })).sort((a, b) => (u.counts[pkgOf(b.x)] || 0) - (u.counts[pkgOf(a.x)] || 0) || a.i - b.i).map((o) => o.x);
}

// ===== دمج استخدام الجهاز (مرآة الكوتلن) مع استخدام التطبيق =====
// كل فتحة ناجحة تُحسب مرة واحدة في جهة (التطبيق أو الكوتلن)، فالأكبر لكل عدّاد هو الصحيح.
// قائمة «آخر ما فتحته» ندمجهما بترتيب: مرآة الكوتلن أولًا (أحدث عند الإقلاع) ثم المحلي.
function mergeUsage(local, native) {
  const a = sanitizeUsage(local);
  const b = sanitizeUsage(native);
  const counts = { ...a.counts };
  for (const [pkg, n] of Object.entries(b.counts)) counts[pkg] = Math.max(counts[pkg] || 0, n);
  const recent = [];
  for (const p of [...b.recent, ...a.recent]) if (!recent.includes(p)) recent.push(p);
  return { counts, recent: recent.slice(0, RECENT_MAX) };
}

module.exports = {
  sanitizeCommands, addAlias, removeAlias, removeApp, countAliases,
  exportJson, parseImport, mergeImport,
  sanitizeUsage, recordUse, topUsed, sortByUsage, mergeUsage,
};
