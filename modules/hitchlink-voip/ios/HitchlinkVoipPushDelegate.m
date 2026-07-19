#import "HitchlinkVoipPushDelegate.h"
#import "RNCallKeep.h"
#import "HitchlinkVoip-Swift.h"

@interface HitchlinkVoipPushDelegate ()
@property (nonatomic, strong, nullable) PKPushRegistry *pushRegistry;
@end

@implementation HitchlinkVoipPushDelegate

+ (instancetype)shared {
    static HitchlinkVoipPushDelegate *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[HitchlinkVoipPushDelegate alloc] init];
    });
    return sharedInstance;
}

- (void)register {
    if (self.pushRegistry != nil) {
        return;
    }
    self.pushRegistry = [[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()];
    self.pushRegistry.delegate = self;
    self.pushRegistry.desiredPushTypes = [NSSet setWithObject:PKPushTypeVoIP];
}

- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)pushCredentials forType:(PKPushType)type {
    if (![type isEqualToString:PKPushTypeVoIP]) {
        return;
    }
    const unsigned char *bytes = pushCredentials.token.bytes;
    NSMutableString *hex = [NSMutableString stringWithCapacity:pushCredentials.token.length * 2];
    for (NSUInteger i = 0; i < pushCredentials.token.length; i++) {
        [hex appendFormat:@"%02x", bytes[i]];
    }
    [[HitchlinkVoipCoordinator shared] updateToken:hex];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type {
    if (![type isEqualToString:PKPushTypeVoIP]) {
        return;
    }
    [[HitchlinkVoipCoordinator shared] updateToken:nil];
}

// Must report a call to CallKit before this method returns (or very shortly
// after, via the completion handler) — Apple terminates apps that receive a
// VoIP push and fail to do so. The payload shape ({"incomingCall": {...}})
// is dictated by the backend's ApnsVoipPushService.cs.
- (void)pushRegistry:(PKPushRegistry *)registry
didReceiveIncomingPushWithPayload:(PKPushPayload *)payload
             forType:(PKPushType)type
withCompletionHandler:(void (^)(void))completion {
    if (![type isEqualToString:PKPushTypeVoIP]) {
        completion();
        return;
    }

    NSDictionary *dict = payload.dictionaryPayload;
    NSDictionary *incoming = dict[@"incomingCall"];
    NSString *serverCallId = incoming[@"serverCallId"] ?: [[NSUUID UUID] UUIDString];
    NSDictionary *caller = incoming[@"caller"];
    NSString *callerName = caller[@"displayName"] ?: @"Dispatcher";
    NSDictionary *metadata = incoming[@"metadata"];

    NSString *uuidString = [[NSUUID UUID] UUIDString];
    NSMutableDictionary *stored = [NSMutableDictionary dictionary];
    stored[@"serverCallId"] = serverCallId;
    stored[@"callerName"] = callerName;
    if (metadata[@"roomUrl"]) stored[@"roomUrl"] = metadata[@"roomUrl"];
    if (metadata[@"token"]) stored[@"token"] = metadata[@"token"];
    if (metadata[@"driverId"]) stored[@"driverId"] = metadata[@"driverId"];
    [[HitchlinkVoipCoordinator shared] putMetadata:stored forUUID:uuidString];

    [RNCallKeep reportNewIncomingCall:uuidString
                               handle:serverCallId
                           handleType:@"generic"
                             hasVideo:NO
                  localizedCallerName:callerName
                      supportsHolding:NO
                         supportsDTMF:NO
                     supportsGrouping:NO
                   supportsUngrouping:NO
                          fromPushKit:YES
                              payload:nil
                withCompletionHandler:^{
        completion();
    }];
}

@end
