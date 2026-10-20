import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'TryOutFlow',
  slug: 'tryoutflow',
  owner: 'thisearlyseason',
  version: '1.0.0',
  scheme: 'tryoutflow',
  icon: './assets/icon.png',
  orientation: 'default',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    buildNumber: '14',
    bundleIdentifier: process.env.TRYOUTFLOW_IOS_BUNDLE_ID ?? 'agency.tryout.mobile',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription: 'Choose an image to upload as your organization logo.',
      NSCameraUsageDescription: 'Take an image when you choose to upload an organization logo.',
    },
  },
  android: {
    versionCode: 15,
    package: process.env.TRYOUTFLOW_ANDROID_PACKAGE ?? 'agency.tryout.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#111e2c',
    },
  },
  plugins: ['expo-secure-store', 'expo-sharing'],
  extra: {
    privacyPolicyUrl: 'https://www.tryout.agency/privacy',
    supportUrl: 'https://www.tryout.agency/support',
    accountDeletionUrl: 'https://www.tryout.agency/delete-account',
    eas: { projectId: '55074bfa-e348-4710-87e2-f0bfb40cc8d9' },
  },
};
export default config;
