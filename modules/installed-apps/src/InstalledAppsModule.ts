import { NativeModule, requireNativeModule } from 'expo';

import type { InstalledApp, SpeechEvents } from './InstalledApps.types';

declare class InstalledAppsModule extends NativeModule<SpeechEvents> {
  getLaunchableApps(): Promise<InstalledApp[]>;
  launchApp(packageName: string): 'ok' | 'not_installed' | 'failed';
  isSpeechAvailable(): boolean;
  startListening(): boolean;
  stopListening(): boolean;
  showToast(text: string): boolean;
  canDrawOverlays(): boolean;
  openOverlaySettings(): boolean;
  isBubbleRunning(): boolean;
  startBubble(): 'ok' | 'no_overlay_permission' | 'no_mic_permission' | 'failed';
  stopBubble(): boolean;
  // الجسر إلى SharedPreferences: الأوامر والاستخدام (مرآة تقرأها الدائرة العائمة في الكوتلن)
  saveCommands(json: string): boolean;
  getCommands(): Promise<string>;
  recordUse(packageName: string): boolean;
  getUsage(): Promise<string>;
  // أوامر الجهاز
  setFlashlight(enabled: boolean): 'ok' | 'no_flash' | 'failed';
  openWifiPanel(): 'ok' | 'failed';
  openBluetoothSettings(): 'ok' | 'failed';
  openAirplaneSettings(): 'ok' | 'failed';
  // البصمة الصوتية (أوفلاين)
  enrollVoice(pkg: string, phrase: string): Promise<'ok' | 'busy' | 'noisy' | 'too_short' | 'inconsistent' | 'failed'>;
  getVoiceprints(): Promise<string>;
  deleteVoiceprint(id: string): Promise<boolean>;
  matchVoice(source: 'app' | 'bubble'): 'started' | 'busy';
  setVoiceThreshold(v: number): boolean;
  getVoiceThreshold(): number;
  // تشخيص البصمة (مرحلة 6): { ok, error?, count, bestPhrase, bestD, threshold, matched }
  diagnoseVoice(): Promise<string>;
}

export default requireNativeModule<InstalledAppsModule>('InstalledApps');
