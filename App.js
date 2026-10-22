import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  canDrawOverlays,
  getLaunchableApps,
  isBubbleRunning,
  isSpeechAvailable,
  launchApp,
  onSpeechError,
  onSpeechResult,
  onSpeechState,
  openOverlaySettings,
  showToast,
  startBubble,
  startListening,
  stopBubble,
  stopListening,
} from './modules/installed-apps';
import KNOWN from './apps';
import { buildApps } from './appList';
import { normalize, tokens, understand, understandBest } from './matcher';
import {
  addAlias,
  countAliases,
  exportJson,
  mergeImport,
  parseImport,
  recordUse,
  removeAlias,
  removeApp,
  sanitizeCommands,
  sanitizeUsage,
  sortByUsage,
  topUsed,
} from './commandStore';

const OLD_STORE_KEY = 'ifta7li.customCommands.v1'; // الشكل القديم: سجل لكل جملة (نقرؤه ونرحّله، ولا نمسحه)
const STORE_KEY = 'ifta7li.customCommands.v2'; // الشكل الجديد: التطبيق ← قائمة صيغ
const USAGE_KEY = 'ifta7li.usage.v1';
const OWN_PKG = 'com.abdo.iftahli';

const LIGHT = { bg: '#F4F7F6', card: '#FFFFFF', text: '#12201C', sub: '#5E6F69', accent: '#0F766E', onAccent: '#FFFFFF', border: '#D6E0DD', warn: '#B45309', danger: '#B91C1C' };
const DARK = { bg: '#0E1513', card: '#17211E', text: '#EAF2EF', sub: '#8FA39D', accent: '#2DD4BF', onAccent: '#06201C', border: '#26352F', warn: '#FBBF24', danger: '#F87171' };

const AVATARS = ['#0F766E', '#2563EB', '#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#0891B2'];
function avatarColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}
function initial(name) {
  const t = String(name || '').trim();
  return t ? Array.from(t)[0].toUpperCase() : '?';
}

// هل التطبيق يطابق ما كتبه المستخدم في خانة البحث؟
function matchesSearch(app, search) {
  const q = tokens(search);
  if (!q.length) return true;
  const hay = [app.name, ...(app.aliases || [])].map(normalize);
  return q.every((t) => hay.some((h) => h.includes(t)));
}

export default function App() {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? DARK : LIGHT;
  const s = useMemo(() => makeStyles(c), [c]);

  const [tab, setTab] = useState('apps'); // apps | cmds
  const [text, setText] = useState('');
  const [message, setMessage] = useState({ kind: 'info', body: 'اكتب أو قل بالميكروفون: "افتح واتساب"' });
  const [teachPhrase, setTeachPhrase] = useState(null); // يظهر زر "علّمني" بعد أمر غير مفهوم
  const [listening, setListening] = useState(false);
  const [bubbleOn, setBubbleOn] = useState(false);
  const handlerRef = useRef({});
  const [choice, setChoice] = useState(null); // { phrase, candidates } فهم غير مؤكد: ننتظر اختيار المستخدم ونتعلّم منه
  const [usage, setUsage] = useState({ counts: {}, recent: [] });
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');

  const [apps, setApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [custom, setCustom] = useState([]);

  // نموذج إضافة أمر جديد
  const [newPhrase, setNewPhrase] = useState('');
  const [pickSearch, setPickSearch] = useState('');
  const [picked, setPicked] = useState(null);

  const loadApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      const installed = await getLaunchableApps();
      setApps(buildApps(installed));
    } catch (e) {
      setMessage({ kind: 'warn', body: 'ما قدرتش أقرأ قائمة التطبيقات من الجوال. تأكد إنك ثبّتت النسخة الكاملة (APK) مش Expo Go.' });
    } finally {
      setLoadingApps(false);
    }
  }, []);

  useEffect(() => {
    loadApps();
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          setCustom(sanitizeCommands(JSON.parse(raw)));
        } else {
          // ترحيل تلقائي من الشكل القديم دون فقد أي أمر (والمفتاح القديم يبقى كما هو)
          const old = await AsyncStorage.getItem(OLD_STORE_KEY);
          if (old) {
            const migrated = sanitizeCommands(JSON.parse(old));
            setCustom(migrated);
            await AsyncStorage.setItem(STORE_KEY, JSON.stringify(migrated));
          }
        }
      } catch (e) {}
      try {
        const u = await AsyncStorage.getItem(USAGE_KEY);
        if (u) setUsage(sanitizeUsage(JSON.parse(u)));
      } catch (e) {}
    })();
  }, [loadApps]);

  async function saveCustom(next) {
    setCustom(next);
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch (e) {
      setMessage({ kind: 'warn', body: 'ما قدرتش أحفظ الأمر على الجوال.' });
    }
  }

  // نسجّل كل فتح ناجح: عدّاد لكل تطبيق + آخر 10
  function noteUse(app) {
    const next = recordUse(usage, app.pkg);
    setUsage(next);
    AsyncStorage.setItem(USAGE_KEY, JSON.stringify(next)).catch(() => {});
  }

  // نتعلّم الصيغة التي قالها المستخدم لو اختار التطبيق بنفسه (إلا لو كان التطبيق يفهمها أصلًا)
  function learnFrom(phrase, app) {
    const clean = tokens(phrase || '').join(' ');
    if (!clean) return null;
    const known = understand(clean, apps, custom);
    if (known && known.confident && known.app.pkg === app.pkg) return null;
    const r = addAlias(custom, app, clean);
    if (!r.added) return null;
    saveCustom(r.list);
    return clean;
  }

  function openApp(app, learnPhrase) {
    let status = 'failed';
    try {
      status = launchApp(app.pkg);
    } catch (e) {
      status = 'failed';
    }
    setChoice(null);
    if (status === 'ok') {
      noteUse(app);
      const learned = learnPhrase ? learnFrom(learnPhrase, app) : null;
      setMessage({ kind: 'ok', body: learned ? `تم فتح ${app.name}. وحفظت إن "${learned}" = ${app.name}.` : `تم فتح ${app.name}` });
      setTeachPhrase(null);
    } else if (status === 'not_installed') {
      offerStore(app);
    } else {
      setMessage({ kind: 'warn', body: `ما قدرتش أفتح ${app.name}. جرّب تفتحه يدويًا أو حدّث قائمة التطبيقات.` });
    }
  }

  function offerStore(app) {
    setMessage({ kind: 'warn', body: `${app.name} غير مثبت على هذا الجهاز.` });
    Alert.alert(`${app.name} غير مثبت`, 'تحب أفتح صفحته في متجر Play؟', [
      { text: 'لا', style: 'cancel' },
      { text: 'افتح المتجر', onPress: () => Linking.openURL(`market://details?id=${app.pkg}`).catch(() => {}) },
    ]);
  }

  function run(command, alts) {
    Keyboard.dismiss();
    setChoice(null);
    const list = alts && alts.length ? alts : [command];
    const result = understandBest(list, apps, custom);
    if (result && result.confident) {
      openApp(result.app);
      setText('');
      return;
    }
    if (result && result.ambiguous) {
      // أكثر من تطبيق متقارب: الأكثر استخدامًا أولًا، واختيارك يُحفظ كصيغة جديدة
      const candidates = sortByUsage([result.app, ...result.others], usage).slice(0, 4);
      setChoice({ phrase: command, candidates });
      setMessage({ kind: 'warn', body: 'تقصد أيهما؟ اضغط على التطبيق المناسب وهفتكر اختيارك.' });
      setTeachPhrase(command);
      return;
    }
    if (result) {
      // فهمناه لكن بثقة منخفضة (تقريب إملائي أو كلمة زائدة): نعرض ونطلب تأكيدًا
      setChoice({ phrase: command, candidates: [result.app] });
      setMessage({ kind: 'warn', body: `فهمت إنك تقصد ${result.app.name}. أفتحه؟` });
      setTeachPhrase(command);
      return;
    }
    // لم نجده بين المثبتة: ربما هو من المعروفين لكنه غير مثبت
    const known = understandBest(list, KNOWN, []);
    if (known && known.confident) {
      offerStore(known.app);
      return;
    }
    setMessage({ kind: 'warn', body: 'ما فهمتش أنهي تطبيق تقصد. تقدر تعلّمني الأمر ده مرة واحدة وأفتحه بعد كده.' });
    setTeachPhrase(command);
  }

  // ===== الصوت =====
  async function ensureMic() {
    const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: 'إذن الميكروفون',
      message: 'علشان أسمع الأمر الصوتي وأفتح التطبيق',
      buttonPositive: 'موافق',
      buttonNegative: 'لا',
    });
    if (g === PermissionsAndroid.RESULTS.GRANTED) return true;
    setMessage({ kind: 'warn', body: 'محتاج إذن الميكروفون علشان أسمعك. فعّله من إعدادات التطبيق.' });
    return false;
  }

  async function toggleListen() {
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }
    if (!(await ensureMic())) return;
    if (!isSpeechAvailable()) {
      setMessage({ kind: 'warn', body: 'خدمة التعرف على الكلام مش متاحة. تأكد إن تطبيق Google مثبّت ومحدّث.' });
      return;
    }
    setTeachPhrase(null);
    setChoice(null);
    setListening(true);
    setMessage({ kind: 'info', body: 'بسمعك... قل اسم التطبيق' });
    startListening();
  }

  async function toggleBubble() {
    if (bubbleOn) {
      stopBubble();
      setBubbleOn(false);
      return;
    }
    if (!(await ensureMic())) return;
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      try {
        await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
      } catch (e) {}
    }
    if (!canDrawOverlays()) {
      Alert.alert(
        'إذن الظهور فوق التطبيقات',
        'لازم تسمح لـ "افتح لي" بالظهور فوق التطبيقات الأخرى. هتفتح لك شاشة الإعدادات: فعّل الإذن ثم ارجع واضغط "تشغيل الدائرة العائمة" تاني.',
        [
          { text: 'لا', style: 'cancel' },
          { text: 'فتح الإعدادات', onPress: () => openOverlaySettings() },
        ]
      );
      return;
    }
    const st = startBubble();
    if (st === 'ok') {
      setBubbleOn(true);
      setMessage({ kind: 'ok', body: 'الدائرة شغالة. اضغطها من أي تطبيق وقل الأمر.' });
    } else {
      setMessage({ kind: 'warn', body: 'ما قدرتش أشغّل الدائرة. تأكد من الأذونات وجرّب تاني.' });
    }
  }

  // أمر جاء من الدائرة العائمة (التطبيق غالبًا في الخلفية)
  function runFromBubble(alts) {
    const r = understandBest(alts, apps, custom);
    if (r && r.confident) {
      let status = 'failed';
      try {
        status = launchApp(r.app.pkg);
      } catch (e) {}
      if (status === 'ok') {
        showToast(`تم فتح ${r.app.name}`);
        noteUse(r.app);
      }
      else if (status === 'not_installed') showToast(`${r.app.name} غير مثبت`);
      else showToast(`ما قدرتش أفتح ${r.app.name}`);
      return;
    }
    // غير مؤكد: نُظهر "افتح لي" ليعرض الفهم ويطلب التأكيد
    try {
      launchApp(OWN_PKG);
    } catch (e) {}
    setText(alts[0]);
    run(alts[0], alts);
  }

  function onState(e) {
    if (e.source === 'app') setListening(e.state !== 'idle');
  }

  function onResult(e) {
    const alts = (e.alternatives ? e.alternatives.split('|') : [e.text]).filter(Boolean);
    if (!alts.length) return;
    if (e.source === 'bubble') {
      runFromBubble(alts);
    } else {
      setText(alts[0]);
      run(alts[0], alts);
    }
  }

  function onError(e) {
    if (e.source === 'app') {
      setListening(false);
      setMessage({ kind: 'warn', body: e.message });
    }
  }

  // نحدّث المعالجات في كل رسم حتى ترى أحدث التطبيقات والأوامر
  handlerRef.current = { onState, onResult, onError };

  useEffect(() => {
    const subs = [
      onSpeechState((e) => handlerRef.current.onState(e)),
      onSpeechResult((e) => handlerRef.current.onResult(e)),
      onSpeechError((e) => handlerRef.current.onError(e)),
    ];
    const sync = () => {
      try {
        setBubbleOn(isBubbleRunning());
      } catch (e) {}
    };
    sync();
    const timer = setInterval(sync, 2000);
    const appSub = AppState.addEventListener('change', (st) => st === 'active' && sync());
    return () => {
      clearInterval(timer);
      subs.forEach((x) => x && x.remove && x.remove());
      appSub && appSub.remove && appSub.remove();
    };
  }, []);

  function startTeaching() {
    setNewPhrase(teachPhrase ? tokens(teachPhrase).join(' ') : '');
    setPicked(null);
    setPickSearch('');
    setTab('cmds');
  }

  function addCommand() {
    const phrase = newPhrase.trim();
    if (!tokens(phrase).length) {
      Alert.alert('الأمر فاضي', 'اكتب كلمة أو جملة غير "افتح" و"شغل" وما شابه، مثل: مزرعتي.');
      return;
    }
    if (!picked) {
      Alert.alert('اختر التطبيق', 'اختر التطبيق اللي عايز الأمر ده يفتحه من القائمة تحت.');
      return;
    }
    const added = addAlias(custom, picked, phrase);
    if (!added.added) {
      Alert.alert('الصيغة موجودة', `الصيغة دي محفوظة بالفعل لـ ${picked.name}.`);
      return;
    }
    saveCustom(added.list);
    setNewPhrase('');
    setPicked(null);
    setPickSearch('');
    setTeachPhrase(null);
    setMessage({ kind: 'ok', body: `تم. لما تقول "${phrase}" هفتح ${picked.name}.` });
  }

  function removeOneAlias(entry, phrase) {
    Alert.alert('حذف الصيغة', `تحذف الصيغة "${phrase}" من ${entry.name}؟`, [
      { text: 'لا', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => saveCustom(removeAlias(custom, entry.pkg, phrase)) },
    ]);
  }

  function removeWholeApp(entry) {
    Alert.alert('حذف كل الصيغ', `تحذف كل صيغ ${entry.name} (${entry.aliases.length})؟`, [
      { text: 'لا', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => saveCustom(removeApp(custom, entry.pkg)) },
    ]);
  }

  // ===== نسخة احتياطية: تصدير واستيراد =====
  async function exportCommands() {
    if (!custom.length) {
      Alert.alert('مفيش أوامر', 'لسه ما أضفتش أوامر علشان تصدّرها.');
      return;
    }
    try {
      await Share.share({ message: exportJson(custom) });
    } catch (e) {
      setMessage({ kind: 'warn', body: 'ما قدرتش أفتح نافذة المشاركة.' });
    }
  }

  function importCommands() {
    const parsed = parseImport(importText);
    if (!parsed.ok) {
      Alert.alert('تعذّر الاستيراد', parsed.error);
      return;
    }
    const merged = mergeImport(custom, parsed.commands);
    saveCustom(merged.list);
    setImportText('');
    setShowImport(false);
    setMessage({
      kind: 'ok',
      body: `تم الاستيراد: ${merged.added} صيغة جديدة${merged.skipped ? `، وتخطيت ${merged.skipped} متعارضة مع أوامرك الحالية` : ''}.`,
    });
  }

  const shownApps = useMemo(() => apps.filter((a) => matchesSearch(a, text)), [apps, text]);
  const pickList = useMemo(() => apps.filter((a) => matchesSearch(a, pickSearch)).slice(0, 40), [apps, pickSearch]);

  const appByPkg = useMemo(() => new Map(apps.map((a) => [a.pkg, a])), [apps]);
  const topApps = useMemo(() => topUsed(usage, 6).map((p) => appByPkg.get(p)).filter(Boolean), [usage, appByPkg]);
  const recentApps = useMemo(() => usage.recent.map((p) => appByPkg.get(p)).filter(Boolean), [usage, appByPkg]);

  const msgColor = message.kind === 'warn' ? c.warn : message.kind === 'ok' ? c.accent : c.border;

  return (
    <View style={s.safe}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <View style={s.headerTexts}>
            <Text style={s.title}>افتح لي</Text>
            <Text style={s.subtitle}>قل اسم التطبيق وأنا أفتحه</Text>
          </View>
          <View style={s.logo}>
            <Text style={s.logoText}>↗</Text>
          </View>
        </View>

        <View style={s.hero}>
          <Pressable style={[s.heroMic, listening && s.heroMicOn]} onPress={toggleListen} accessibilityRole="button" accessibilityLabel="تحدث بالصوت">
            <Text style={s.heroMicText}>{listening ? '■' : '🎤'}</Text>
          </Pressable>
          <Text style={s.heroLabel}>{listening ? 'بسمعك... قل اسم التطبيق' : 'اضغط وتكلّم، مثال: "افتح واتساب"'}</Text>
        </View>

        <View style={s.inputRow}>
          <Pressable style={s.goBtn} onPress={() => run(text)} accessibilityRole="button" accessibilityLabel="افتح">
            <Text style={s.goText}>افتح</Text>
          </Pressable>
          <TextInput
            style={s.input}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => run(text)}
            placeholder="أو اكتب: افتحلي يوتيوب"
            placeholderTextColor={c.sub}
            returnKeyType="go"
            textAlign="right"
            autoCorrect={false}
          />
        </View>

        <View style={s.bubbleCard}>
          <Switch value={bubbleOn} onValueChange={toggleBubble} trackColor={{ false: c.border, true: c.accent }} thumbColor="#FFFFFF" />
          <View style={s.bubbleInfo}>
            <Text style={s.bubbleTitle}>الدائرة العائمة</Text>
            <Text style={s.bubbleSub}>{bubbleOn ? 'شغالة. اسحبها إلى ✕ أسفل الشاشة لإغلاقها' : 'تظهر فوق أي تطبيق لتتكلم من أي مكان'}</Text>
          </View>
        </View>

        <View style={[s.message, { borderColor: msgColor, borderRightColor: msgColor }]}>
          <Text style={[s.messageText, message.kind === 'warn' && { color: c.warn }]}>{message.body}</Text>
          {choice ? (
            <View style={s.choiceRow}>
              {choice.candidates.map((a) => (
                <Pressable key={a.pkg} style={[s.teachBtn, { marginLeft: 8 }]} onPress={() => { openApp(a, choice.phrase); setText(''); }} accessibilityRole="button">
                  <Text style={s.teachText}>{choice.candidates.length === 1 ? `نعم، افتح ${a.name}` : `افتح ${a.name}`}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {teachPhrase ? (
            <Pressable style={s.teachBtn} onPress={startTeaching} accessibilityRole="button">
              <Text style={s.teachText}>علّمني الأمر ده</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={s.tabs}>
          <Pressable style={[s.tab, tab === 'apps' && s.tabOn]} onPress={() => setTab('apps')} accessibilityRole="tab">
            <Text style={[s.tabText, tab === 'apps' && s.tabTextOn]}>تطبيقاتي ({apps.length})</Text>
          </Pressable>
          <Pressable style={[s.tab, tab === 'cmds' && s.tabOn]} onPress={() => setTab('cmds')} accessibilityRole="tab">
            <Text style={[s.tabText, tab === 'cmds' && s.tabTextOn]}>أوامري ({countAliases(custom)})</Text>
          </Pressable>
        </View>

        {tab === 'apps' ? (
          loadingApps ? (
            <ActivityIndicator style={{ marginTop: 30 }} color={c.accent} />
          ) : (
            <FlatList
              key="apps-grid"
              data={shownApps}
              keyExtractor={(a) => a.pkg}
              numColumns={3}
              contentContainerStyle={s.grid}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                !text.trim() && (topApps.length || recentApps.length) ? (
                  <View style={s.usageBox}>
                    {topApps.length ? (
                      <View>
                        <Text style={s.usageTitle}>الأكثر استخداماً</Text>
                        <View style={s.chipRow}>
                          {topApps.map((a) => (
                            <Pressable key={`top-${a.pkg}`} style={s.chip} onPress={() => openApp(a)} accessibilityRole="button" accessibilityLabel={`افتح ${a.name}`}>
                              <Text style={s.chipText} numberOfLines={1}>{a.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}
                    {recentApps.length ? (
                      <View style={{ marginTop: topApps.length ? 10 : 0 }}>
                        <Text style={s.usageTitle}>آخر ما فتحته</Text>
                        <View style={s.chipRow}>
                          {recentApps.map((a) => (
                            <Pressable key={`recent-${a.pkg}`} style={s.chip} onPress={() => openApp(a)} accessibilityRole="button" accessibilityLabel={`افتح ${a.name}`}>
                              <Text style={s.chipText} numberOfLines={1}>{a.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null
              }
              ListEmptyComponent={<Text style={s.empty}>{apps.length ? 'مفيش تطبيق بالاسم ده.' : 'القائمة فاضية. اضغط "تحديث قائمة التطبيقات" تحت.'}</Text>}
              ListFooterComponent={
                <Pressable style={s.refresh} onPress={loadApps} accessibilityRole="button">
                  <Text style={s.refreshText}>تحديث قائمة التطبيقات</Text>
                </Pressable>
              }
              renderItem={({ item }) => (
                <Pressable style={s.tile} onPress={() => openApp(item)} accessibilityRole="button" accessibilityLabel={`افتح ${item.name}`}>
                  <View style={[s.avatar, { backgroundColor: avatarColor(item.name) }]}>
                    <Text style={s.avatarText}>{initial(item.name)}</Text>
                  </View>
                  <Text style={s.tileText} numberOfLines={2}>
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
          )
        ) : (
          <FlatList
            key="cmds-list"
            data={custom}
            keyExtractor={(x) => x.pkg}
            contentContainerStyle={s.grid}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View style={s.form}>
                <Text style={s.formTitle}>أمر جديد</Text>
                <TextInput
                  style={s.input}
                  value={newPhrase}
                  onChangeText={setNewPhrase}
                  placeholder='الجملة اللي هتقولها، مثال: مزرعتي'
                  placeholderTextColor={c.sub}
                  textAlign="right"
                  autoCorrect={false}
                />
                <Text style={s.formLabel}>{picked ? `التطبيق: ${picked.name}` : 'اختر التطبيق اللي يفتحه:'}</Text>
                <TextInput
                  style={[s.input, { marginTop: 6 }]}
                  value={pickSearch}
                  onChangeText={setPickSearch}
                  placeholder="ابحث عن التطبيق"
                  placeholderTextColor={c.sub}
                  textAlign="right"
                  autoCorrect={false}
                />
                <ScrollView style={s.pickBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {pickList.map((a) => (
                    <Pressable key={a.pkg} style={[s.pickItem, picked && picked.pkg === a.pkg && s.pickItemOn]} onPress={() => setPicked(a)}>
                      <Text style={[s.pickText, picked && picked.pkg === a.pkg && { color: c.onAccent }]} numberOfLines={1}>
                        {a.name}
                      </Text>
                    </Pressable>
                  ))}
                  {!pickList.length ? <Text style={s.empty}>مفيش تطبيق بالاسم ده.</Text> : null}
                </ScrollView>
                <Pressable style={s.saveBtn} onPress={addCommand} accessibilityRole="button">
                  <Text style={s.goText}>حفظ الأمر</Text>
                </Pressable>
                <Text style={[s.formTitle, { marginTop: 20 }]}>أوامري المحفوظة</Text>
                {custom.length ? <Text style={s.formLabel}>اضغط على أي صيغة لحذفها. تقدر تضيف لنفس التطبيق أكثر من صيغة.</Text> : null}
              </View>
            }
            ListEmptyComponent={<Text style={s.empty}>لسه ما أضفتش أوامر.</Text>}
            ListFooterComponent={
              <View style={s.backupBox}>
                <Text style={s.formTitle}>نسخة احتياطية</Text>
                <Text style={s.formLabel}>صدّر أوامرك واحفظها في أي مكان، أو الصق نسخة سابقة لاسترجاعها. الاستيراد يضيف ولا يمسح شيئًا.</Text>
                <View style={s.backupRow}>
                  <Pressable style={s.saveBtnHalf} onPress={() => setShowImport((v) => !v)} accessibilityRole="button">
                    <Text style={s.goText}>{showImport ? 'إخفاء الاستيراد' : 'استيراد'}</Text>
                  </Pressable>
                  <Pressable style={s.saveBtnHalf} onPress={exportCommands} accessibilityRole="button">
                    <Text style={s.goText}>تصدير الأوامر</Text>
                  </Pressable>
                </View>
                {showImport ? (
                  <View>
                    <TextInput
                      style={[s.input, s.importInput]}
                      value={importText}
                      onChangeText={setImportText}
                      placeholder="الصق هنا النص الذي نسخته من التصدير"
                      placeholderTextColor={c.sub}
                      multiline
                      textAlign="right"
                      autoCorrect={false}
                    />
                    <Pressable style={s.saveBtn} onPress={importCommands} accessibilityRole="button">
                      <Text style={s.goText}>استيراد الآن</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <View style={s.cmdCard}>
                <View style={s.cmdHead}>
                  <Pressable onPress={() => removeWholeApp(item)} accessibilityRole="button" accessibilityLabel={`حذف كل صيغ ${item.name}`}>
                    <Text style={s.del}>حذف الكل</Text>
                  </Pressable>
                  <Text style={s.cmdApp} numberOfLines={1}>{item.name}</Text>
                </View>
                <View style={s.chipRow}>
                  {item.aliases.map((al) => (
                    <Pressable key={al} style={s.aliasChip} onPress={() => removeOneAlias(item, al)} accessibilityRole="button" accessibilityLabel={`حذف ${al}`}>
                      <Text style={s.aliasText}>{`${al}  ✕`}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: c.bg, paddingTop: Platform.OS === 'android' ? 36 : 50 },
    header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, alignItems: 'flex-end' },
    title: { fontSize: 30, fontWeight: '800', color: c.text, writingDirection: 'rtl' },
    subtitle: { fontSize: 15, color: c.sub, marginTop: 2, writingDirection: 'rtl' },
    inputRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 8 },
    input: {
      flex: 1,
      backgroundColor: c.card,
      color: c.text,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 17,
      writingDirection: 'rtl',
    },
    goBtn: { backgroundColor: c.accent, borderRadius: 14, paddingHorizontal: 20, justifyContent: 'center' },
    goText: { color: c.onAccent, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    hint: { marginHorizontal: 20, marginTop: 6, color: c.sub, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
    message: { marginHorizontal: 16, marginTop: 10, padding: 12, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderRightWidth: 4 },
    messageText: { color: c.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl', lineHeight: 22 },
    teachBtn: { alignSelf: 'flex-end', marginTop: 8, backgroundColor: c.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
    teachText: { color: c.onAccent, fontWeight: '700', fontSize: 14 },
    tabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 12, gap: 8 },
    tab: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, alignItems: 'center' },
    tabOn: { backgroundColor: c.accent, borderColor: c.accent },
    tabText: { color: c.text, fontWeight: '600', fontSize: 15 },
    tabTextOn: { color: c.onAccent },
    grid: { padding: 12, paddingBottom: 60 },
    tile: {
      flex: 1 / 3,
      margin: 4,
      minHeight: 96,
      backgroundColor: c.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    },
    tileText: { color: c.text, fontSize: 14, fontWeight: '600', textAlign: 'center', writingDirection: 'rtl' },
    empty: { color: c.sub, textAlign: 'center', padding: 16, fontSize: 14 },
    refresh: { alignSelf: 'center', marginTop: 14, padding: 10 },
    refreshText: { color: c.accent, fontWeight: '700', fontSize: 14 },
    form: { paddingHorizontal: 4 },
    formTitle: { color: c.text, fontSize: 18, fontWeight: '800', textAlign: 'right', marginBottom: 8, writingDirection: 'rtl' },
    formLabel: { color: c.sub, fontSize: 14, textAlign: 'right', marginTop: 12, writingDirection: 'rtl' },
    pickBox: { marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, maxHeight: 240, overflow: 'hidden', paddingVertical: 4 },
    pickItem: { paddingHorizontal: 14, paddingVertical: 10 },
    pickItemOn: { backgroundColor: c.accent },
    pickText: { color: c.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
    saveBtn: { marginTop: 12, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 13 },
    cmdRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 8 },
    cmdText: { flex: 1, color: c.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl', marginLeft: 10 },
    micBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 16, justifyContent: 'center' },
    micOn: { backgroundColor: c.danger, borderColor: c.danger },
    micText: { fontSize: 20, color: c.text },
    bubbleBtn: { marginHorizontal: 16, marginTop: 8, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.accent, alignItems: 'center' },
    bubbleText: { color: c.accent, fontWeight: '700', fontSize: 14 },
    del: { color: c.danger, fontWeight: '700', fontSize: 14, padding: 4 },
    headerTexts: { alignItems: 'flex-end' },
    logo: { width: 48, height: 48, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
    logoText: { color: c.onAccent, fontSize: 26, fontWeight: '800' },
    hero: { alignItems: 'center', marginTop: 10 },
    heroMic: { width: 84, height: 84, borderRadius: 42, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    heroMicOn: { backgroundColor: c.danger },
    heroMicText: { fontSize: 34, color: '#FFFFFF' },
    heroLabel: { marginTop: 8, color: c.sub, fontSize: 14, writingDirection: 'rtl', textAlign: 'center' },
    bubbleCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border },
    bubbleInfo: { flex: 1, alignItems: 'flex-end', marginLeft: 10 },
    bubbleTitle: { color: c.text, fontSize: 15, fontWeight: '700', writingDirection: 'rtl' },
    bubbleSub: { color: c.sub, fontSize: 12.5, marginTop: 2, textAlign: 'right', writingDirection: 'rtl' },
    choiceRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
    usageBox: { marginBottom: 10, padding: 10, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border },
    usageTitle: { color: c.sub, fontSize: 13, fontWeight: '700', textAlign: 'right', marginBottom: 6, writingDirection: 'rtl' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
    chip: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 6, marginBottom: 6, maxWidth: 150 },
    chipText: { color: c.text, fontSize: 13.5, fontWeight: '600', writingDirection: 'rtl' },
    cmdCard: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, marginBottom: 8 },
    cmdHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    cmdApp: { flex: 1, color: c.text, fontSize: 16, fontWeight: '800', textAlign: 'right', writingDirection: 'rtl', marginLeft: 10 },
    aliasChip: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.accent, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 6, marginBottom: 6 },
    aliasText: { color: c.text, fontSize: 14, writingDirection: 'rtl' },
    backupBox: { marginTop: 24 },
    backupRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    saveBtnHalf: { flex: 1, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 13 },
    importInput: { marginTop: 10, minHeight: 110, textAlignVertical: 'top' },
    avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  });
}
