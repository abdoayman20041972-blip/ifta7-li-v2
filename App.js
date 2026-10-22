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
  StyleSheet,
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
import { normalize, tokens, understandBest } from './matcher';

const STORE_KEY = 'ifta7li.customCommands.v1';
const OWN_PKG = 'com.abdo.iftahli';

const LIGHT = { bg: '#F4F7F6', card: '#FFFFFF', text: '#12201C', sub: '#5E6F69', accent: '#0F766E', onAccent: '#FFFFFF', border: '#D6E0DD', warn: '#B45309', danger: '#B91C1C' };
const DARK = { bg: '#0E1513', card: '#17211E', text: '#EAF2EF', sub: '#8FA39D', accent: '#2DD4BF', onAccent: '#06201C', border: '#26352F', warn: '#FBBF24', danger: '#F87171' };

// تنقية الأوامر المحفوظة: نقبل فقط مصفوفة سجلاتها فيها phrase و pkg نصيّان، ونتجاهل أي سجل ناقص أو تالف.
// لا نغيّر شكل السجلات الصحيحة، فتبقى متوافقة مع البيانات المحفوظة.
function sanitizeCommands(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => x && typeof x === 'object' && typeof x.phrase === 'string' && typeof x.pkg === 'string')
    .map((x) => (typeof x.name === 'string' ? x : { ...x, name: x.pkg }));
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
  const [pending, setPending] = useState(null); // تطبيق فهمناه بثقة منخفضة وننتظر تأكيد المستخدم

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
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => raw && setCustom(sanitizeCommands(JSON.parse(raw))))
      .catch(() => {});
  }, [loadApps]);

  async function saveCustom(next) {
    setCustom(next);
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch (e) {
      setMessage({ kind: 'warn', body: 'ما قدرتش أحفظ الأمر على الجوال.' });
    }
  }

  function openApp(app) {
    let status = 'failed';
    try {
      status = launchApp(app.pkg);
    } catch (e) {
      status = 'failed';
    }
    setPending(null);
    if (status === 'ok') {
      setMessage({ kind: 'ok', body: `تم فتح ${app.name}` });
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
    setPending(null);
    const list = alts && alts.length ? alts : [command];
    const result = understandBest(list, apps, custom);
    if (result && result.confident) {
      openApp(result.app);
      setText('');
      return;
    }
    if (result && result.ambiguous) {
      const names = [result.app, ...result.others].slice(0, 3).map((a) => a.name).join(' أو ');
      setMessage({ kind: 'warn', body: `مش متأكد، تقصد ${names}؟ اضغط على التطبيق المناسب من القائمة.` });
      setTeachPhrase(command);
      return;
    }
    if (result) {
      // فهمناه لكن بثقة منخفضة (تقريب إملائي أو كلمة زائدة): نعرض ونطلب تأكيدًا
      setPending(result.app);
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
    setPending(null);
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
      if (status === 'ok') showToast(`تم فتح ${r.app.name}`);
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
    const appSub = AppState.addEventListener('change', (st) => st === 'active' && sync());
    return () => {
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
    const same = normalize(tokens(phrase).join(' '));
    const rest = custom.filter((x) => normalize(tokens(x.phrase).join(' ')) !== same);
    saveCustom([{ phrase, pkg: picked.pkg, name: picked.name }, ...rest]);
    setNewPhrase('');
    setPicked(null);
    setPickSearch('');
    setTeachPhrase(null);
    setMessage({ kind: 'ok', body: `تم. لما تقول "${phrase}" هفتح ${picked.name}.` });
  }

  function removeCommand(entry) {
    Alert.alert('حذف الأمر', `تحذف الأمر "${entry.phrase}"؟`, [
      { text: 'لا', style: 'cancel' },
      { text: 'حذف', style: 'destructive', onPress: () => saveCustom(custom.filter((x) => x !== entry)) },
    ]);
  }

  const shownApps = useMemo(() => apps.filter((a) => matchesSearch(a, text)), [apps, text]);
  const pickList = useMemo(() => apps.filter((a) => matchesSearch(a, pickSearch)).slice(0, 40), [apps, pickSearch]);

  const msgColor = message.kind === 'warn' ? c.warn : message.kind === 'ok' ? c.accent : c.border;

  return (
    <View style={s.safe}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <Text style={s.title}>افتح لي</Text>
          <Text style={s.subtitle}>قل اسم التطبيق وأنا أفتحه</Text>
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
            placeholder="مثال: افتحلي يوتيوب"
            placeholderTextColor={c.sub}
            returnKeyType="go"
            textAlign="right"
            autoCorrect={false}
          />
          <Pressable style={[s.micBtn, listening && s.micOn]} onPress={toggleListen} accessibilityRole="button" accessibilityLabel="تحدث بالصوت">
            <Text style={s.micText}>{listening ? '...' : '🎤'}</Text>
          </Pressable>
        </View>
        <Text style={s.hint}>اضغط الميكروفون وقل الأمر، مثال: "افتح واتساب".</Text>
        <Pressable style={s.bubbleBtn} onPress={toggleBubble} accessibilityRole="button">
          <Text style={s.bubbleText}>{bubbleOn ? 'إيقاف الدائرة العائمة' : 'تشغيل الدائرة العائمة'}</Text>
        </Pressable>

        <View style={[s.message, { borderColor: msgColor }]}>
          <Text style={[s.messageText, message.kind === 'warn' && { color: c.warn }]}>{message.body}</Text>
          {pending ? (
            <Pressable style={s.teachBtn} onPress={() => { openApp(pending); setText(''); }} accessibilityRole="button">
              <Text style={s.teachText}>{`نعم، افتح ${pending.name}`}</Text>
            </Pressable>
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
            <Text style={[s.tabText, tab === 'cmds' && s.tabTextOn]}>أوامري ({custom.length})</Text>
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
              ListEmptyComponent={<Text style={s.empty}>{apps.length ? 'مفيش تطبيق بالاسم ده.' : 'القائمة فاضية. اضغط "تحديث قائمة التطبيقات" تحت.'}</Text>}
              ListFooterComponent={
                <Pressable style={s.refresh} onPress={loadApps} accessibilityRole="button">
                  <Text style={s.refreshText}>تحديث قائمة التطبيقات</Text>
                </Pressable>
              }
              renderItem={({ item }) => (
                <Pressable style={s.tile} onPress={() => openApp(item)} accessibilityRole="button" accessibilityLabel={`افتح ${item.name}`}>
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
            keyExtractor={(x, i) => `${x.phrase}-${i}`}
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
              </View>
            }
            ListEmptyComponent={<Text style={s.empty}>لسه ما أضفتش أوامر.</Text>}
            renderItem={({ item }) => (
              <View style={s.cmdRow}>
                <Pressable onPress={() => removeCommand(item)} accessibilityRole="button" accessibilityLabel={`حذف ${item.phrase}`}>
                  <Text style={s.del}>حذف</Text>
                </Pressable>
                <Text style={s.cmdText} numberOfLines={2}>
                  "{item.phrase}" ← {item.name}
                </Text>
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
    message: { marginHorizontal: 16, marginTop: 10, padding: 12, backgroundColor: c.card, borderRadius: 14, borderWidth: 1 },
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
      minHeight: 64,
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
  });
}
