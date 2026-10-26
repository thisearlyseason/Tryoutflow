#import <React/RCTBridgeModule.h>
#import <Security/Security.h>

// Compatible with Expo SecureStore's default app:no-auth/app keychain entries.
// This app never requested biometric storage or a custom access group/service.
@interface TryOutSecureStore : NSObject <RCTBridgeModule>
@end
@implementation TryOutSecureStore
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (NSMutableDictionary *)query:(NSString *)key service:(NSString *)service {
  NSData *encoded = [key dataUsingEncoding:NSUTF8StringEncoding];
  return [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: service,
            (__bridge id)kSecAttrGeneric: encoded,
            (__bridge id)kSecAttrAccount: encoded} mutableCopy];
}
- (BOOL)valid:(NSString *)key reject:(RCTPromiseRejectBlock)reject {
  if (key.length && [key rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"] invertedSet]].location == NSNotFound) return YES;
  reject(@"secure_store_key", @"Invalid secure-storage key.", nil);
  return NO;
}
RCT_EXPORT_METHOD(getItem:(NSString *)key resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  if (![self valid:key reject:reject]) return;
  for (NSString *service in @[@"app:no-auth", @"app:auth", @"app"]) {
    NSMutableDictionary *query = [self query:key service:service];
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) continue;
    if (status != errSecSuccess) { reject(@"secure_store_read", @"Secure storage could not be read.", nil); return; }
    NSData *data = CFBridgingRelease(result);
    NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!value) { reject(@"secure_store_encoding", @"Invalid secure-storage encoding.", nil); return; }
    resolve(value); return;
  }
  resolve([NSNull null]);
}
RCT_EXPORT_METHOD(setItem:(NSString *)key value:(NSString *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  if (![self valid:key reject:reject]) return;
  NSMutableDictionary *query = [self query:key service:@"app:no-auth"];
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData: data});
  if (status == errSecItemNotFound) {
    query[(__bridge id)kSecValueData] = data;
    query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
    status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
  }
  if (status != errSecSuccess) { reject(@"secure_store_write", @"Secure storage could not be saved.", nil); return; }
  resolve(nil);
}
RCT_EXPORT_METHOD(deleteItem:(NSString *)key resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  if (![self valid:key reject:reject]) return;
  for (NSString *service in @[@"app:no-auth", @"app:auth", @"app"]) {
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)[self query:key service:service]);
    if (status != errSecSuccess && status != errSecItemNotFound) { reject(@"secure_store_delete", @"Secure storage could not be removed.", nil); return; }
  }
  resolve(nil);
}
@end
