import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage, PURCHASES_ERROR_CODE } from 'react-native-purchases';
let configured = false;
export async function identifyPurchaser(userId: string) {
  const key =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY;
  if (!key) throw new Error('Purchases are not available yet.');
  if (!configured) {
    Purchases.configure({ apiKey: key, appUserID: userId });
    configured = true;
  } else if ((await Purchases.getAppUserID()) !== userId) await Purchases.logIn(userId);
}
export async function getOfferings() {
  const offering = (await Purchases.getOfferings()).current;
  if (!offering) return [];
  if (offering.identifier !== 'tryoutflow_v1')
    throw new Error('TryOutFlow purchases are temporarily unavailable.');
  const products: Record<string, { ios: string; android: string }> = {
    pro_monthly: { ios: 'agency.tryout.pro.monthly', android: 'agency.tryout.pro:monthly' },
    pro_annual: { ios: 'agency.tryout.pro.annual', android: 'agency.tryout.pro:annual' },
    organization_monthly: {
      ios: 'agency.tryout.organization.monthly',
      android: 'agency.tryout.organization:monthly',
    },
    organization_annual: {
      ios: 'agency.tryout.organization.annual',
      android: 'agency.tryout.organization:annual',
    },
    single_tryout_pro: {
      ios: 'agency.tryout.single_tryout_pro',
      android: 'agency.tryout.single_tryout_pro',
    },
  };
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  return offering.availablePackages.filter(
    (item) => products[item.identifier]?.[platform] === item.product.identifier,
  );
}
export async function purchasePackage(selected: PurchasesPackage) {
  return Purchases.purchasePackage(selected);
}
export async function restorePurchases() {
  return Purchases.restorePurchases();
}
export async function getCustomerEntitlements() {
  return Purchases.getCustomerInfo();
}
export function purchaseError(error: unknown) {
  const value = error as { code?: string; userCancelled?: boolean };
  if (value.userCancelled || value.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)
    return "Purchase cancelled. You haven't been charged.";
  if (value.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR)
    return 'Your purchase is awaiting store approval. Access will update after confirmation.';
  return "We couldn't complete your purchase. Please try again.";
}
