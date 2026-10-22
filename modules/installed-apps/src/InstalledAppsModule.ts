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
}

export default requireNativeModule<InstalledAppsModule>('InstalledApps');
