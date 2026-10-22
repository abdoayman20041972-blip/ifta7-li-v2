import InstalledAppsModule from './src/InstalledAppsModule';

export type { InstalledApp } from './src/InstalledApps.types';
export const getLaunchableApps = () => InstalledAppsModule.getLaunchableApps();
export const launchApp = (pkg: string) => InstalledAppsModule.launchApp(pkg);
