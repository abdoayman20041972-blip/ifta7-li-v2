import InstalledAppsModule from './src/InstalledAppsModule';
import type { SpeechErrorEvent, SpeechResultEvent, SpeechStateEvent } from './src/InstalledApps.types';

export type { InstalledApp, SpeechErrorEvent, SpeechResultEvent, SpeechStateEvent } from './src/InstalledApps.types';
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

export const onSpeechResult = (cb: (e: SpeechResultEvent) => void) => InstalledAppsModule.addListener('onSpeechResult', cb);
export const onSpeechState = (cb: (e: SpeechStateEvent) => void) => InstalledAppsModule.addListener('onSpeechState', cb);
export const onSpeechError = (cb: (e: SpeechErrorEvent) => void) => InstalledAppsModule.addListener('onSpeechError', cb);
