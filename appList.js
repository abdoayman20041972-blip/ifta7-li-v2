// يدمج التطبيقات المثبتة فعلاً على الجوال مع الأسماء الدارجة الجاهزة في apps.js
const KNOWN = require('./apps');

function buildApps(installed) {
  const byPkg = new Map(KNOWN.map((k) => [k.pkg, k]));
  return installed.map(({ name, pkg }) => {
    const known = byPkg.get(pkg);
    return { name, pkg, aliases: [name, ...(known ? known.aliases : [])] };
  });
}

module.exports = { buildApps };
