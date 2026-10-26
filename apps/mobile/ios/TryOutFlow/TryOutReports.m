#import <React/RCTBridgeModule.h>
#import <WebKit/WebKit.h>

@interface TryOutReportRenderer : UIPrintPageRenderer
@end
@implementation TryOutReportRenderer
- (CGRect)paperRect { return CGRectMake(0, 0, 612, 792); }
- (CGRect)printableRect { return CGRectInset(self.paperRect, 20, 20); }
@end

@interface TryOutReports : NSObject <RCTBridgeModule, WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *web;
@property(nonatomic, copy) RCTPromiseResolveBlock resolve;
@property(nonatomic, copy) RCTPromiseRejectBlock reject;
@property(nonatomic, strong) NSURL *destination;
@end
@implementation TryOutReports
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (void)finish:(NSError *)error {
  if (!self.resolve) return;
  if (error) {
    [[NSFileManager defaultManager] removeItemAtURL:self.destination error:nil];
    self.reject(@"report_pdf", @"The report could not be prepared.", nil);
  } else { self.resolve(self.destination.absoluteString); }
  [self.web stopLoading]; self.web.navigationDelegate = nil;
  self.web = nil; self.resolve = nil; self.reject = nil; self.destination = nil;
}
RCT_EXPORT_METHOD(printToFile:(NSString *)html name:(NSString *)name resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  if (self.web || ![name hasPrefix:@"tryoutflow-report-"] || ![name hasSuffix:@".pdf"] ||
      [name containsString:@"/"] || [name containsString:@".."] || html.length > 20000000) {
    reject(@"report_pdf", @"Report preparation is unavailable.", nil); return;
  }
  self.resolve = resolve; self.reject = reject;
  self.destination = [[[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:name];
  WKWebViewConfiguration *config = [WKWebViewConfiguration new];
  config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  config.defaultWebpagePreferences.allowsContentJavaScript = NO;
  self.web = [[WKWebView alloc] initWithFrame:CGRectMake(0, 0, 612, 792) configuration:config];
  self.web.navigationDelegate = self;
  WKWebView *owned = self.web;
  [self.web loadHTMLString:html baseURL:nil];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (self.web == owned) [self finish:[NSError errorWithDomain:@"report_timeout" code:1 userInfo:nil]];
  });
}
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
  if (webView != self.web) return;
  UIPrintPageRenderer *renderer = [TryOutReportRenderer new];
  [renderer addPrintFormatter:webView.viewPrintFormatter startingAtPageAtIndex:0];
  CGRect paper = CGRectMake(0, 0, 612, 792);
  NSMutableData *data = [NSMutableData data];
  UIGraphicsBeginPDFContextToData(data, paper, nil);
  [renderer prepareForDrawingPages:NSMakeRange(0, renderer.numberOfPages)];
  for (NSInteger page = 0; page < renderer.numberOfPages; page++) {
    UIGraphicsBeginPDFPage(); [renderer drawPageAtIndex:page inRect:paper];
  }
  UIGraphicsEndPDFContext();
  NSError *error = nil;
  if (!data.length || ![data writeToURL:self.destination options:NSDataWritingAtomic error:&error]) {
    [self finish:error ?: [NSError errorWithDomain:@"report_empty" code:1 userInfo:nil]];
  } else { [self finish:nil]; }
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { if (webView == self.web) [self finish:error]; }
- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { if (webView == self.web) [self finish:error]; }
@end
