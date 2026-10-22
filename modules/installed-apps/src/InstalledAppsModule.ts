import { NativeModule, requireNativeModule } from 'expo';

import type { InstalledApp } from './InstalledApps.types';

declare class InstalledAppsModule extends NativeModule<{}> {
  getLaunchableApps(): Promise<InstalledApp[]>;
  launchApp(packageName: string): boolean;
}

export default requireNativeModule<InstalledAppsModule>('InstalledApps');
