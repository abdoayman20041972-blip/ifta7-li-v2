import InstalledAppsModule from './src/InstalledAppsModule';
import type { SpeechErrorEvent, SpeechResultEvent, SpeechStateEvent, VoiceNoMatchEvent } from './src/InstalledApps.types';

export type { InstalledApp, SpeechErrorEvent, SpeechResultEvent, SpeechStateEvent, VoiceNoMatchEvent, VoicePrint } from './src/InstalledApps.types';
export type LaunchResult = 'ok' | 'not_installed' | 'failed';

export const getLaunchableApps = () => InstalledAppsModule.getLaunchableApps();
export const launchApp = (pkg: string) => InstalledAppsModule.launchApp(pkg);

export const isSpeechAvailable = () => InstalledAppsModule.isSpeechAvailable();
export const startListening = () => InstalledAppsModule.startListening();
export const stopListening = () => InstalledAppsModule.stopListening();
export const showToast = (text: string) => InstalledAppsModule.showToast(text);

export const canDrawOverlays = () => InstalledAppsModule.canDrawOverlays();
export const openOverlaySettings = () => InstalledAppsModule.openOverlaySettings();
export const isBubbleRunning = () => InstalledAppsModule.isBubbleRunning();
export const startBubble = () => InstalledAppsModule.startBubble();
export const stopBubble = () => InstalledAppsModule.stopBubble();

// الجسر إلى SharedPreferences (المرآة التي تقرأها الدائرة العائمة في الكوتلن)
export const saveCommands = (json: string) => InstalledAppsModule.saveCommands(json);
export const getCommands = () => InstalledAppsModule.getCommands();
export const getUsage = () => InstalledAppsModule.getUsage();

// أوامر الجهاز
export const setFlashlight = (enabled: boolean) => InstalledAppsModule.setFlashlight(enabled);
export const openWifiPanel = () => InstalledAppsModule.openWifiPanel();
export const openBluetoothSettings = () => InstalledAppsModule.openBluetoothSettings();
export const openAirplaneSettings = () => InstalledAppsModule.openAirplaneSettings();

// البصمة الصوتية (أوفلاين)
export const enrollVoice = (pkg: string, phrase: string) => InstalledAppsModule.enrollVoice(pkg, phrase);
export const getVoiceprints = () => InstalledAppsModule.getVoiceprints();
export const deleteVoiceprint = (id: string) => InstalledAppsModule.deleteVoiceprint(id);
export const matchVoice = (source: 'app' | 'bubble') => InstalledAppsModule.matchVoice(source);
export const setVoiceThreshold = (v: number) => InstalledAppsModule.setVoiceThreshold(v);
export const getVoiceThreshold = () => InstalledAppsModule.getVoiceThreshold();
// تشخيص البصمة (مرحلة 6): أرقام خام بلا تنفيذ
export const diagnoseVoice = () => InstalledAppsModule.diagnoseVoice();

export const onSpeechResult = (cb: (e: SpeechResultEvent) => void) => InstalledAppsModule.addListener('onSpeechResult', cb);
export const onSpeechState = (cb: (e: SpeechStateEvent) => void) => InstalledAppsModule.addListener('onSpeechState', cb);
export const onSpeechError = (cb: (e: SpeechErrorEvent) => void) => InstalledAppsModule.addListener('onSpeechError', cb);
export const onVoiceNoMatch = (cb: (e: VoiceNoMatchEvent) => void) => InstalledAppsModule.addListener('onVoiceNoMatch', cb);
