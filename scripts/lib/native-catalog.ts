export type NativeOfferingPackage = {
  platform_product_identifier: string;
  platform_product_plan_identifier?: string | null;
};

export function nativeProductIdentifier(platform: string, item: NativeOfferingPackage): string {
  // RevenueCat returns Google subscription and base-plan IDs separately. Server mappings use
  // the combined store identifier; comparing only the subscription loses monthly/annual identity.
  if (platform === 'google' && item.platform_product_plan_identifier) {
    return `${item.platform_product_identifier}:${item.platform_product_plan_identifier}`;
  }
  return item.platform_product_identifier;
}
