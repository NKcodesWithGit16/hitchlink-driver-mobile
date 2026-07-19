#import <Foundation/Foundation.h>
#import <PushKit/PushKit.h>

NS_ASSUME_NONNULL_BEGIN

// PKPushRegistry owner + delegate, in plain Objective-C so it can
// `#import <RNCallKeep.h>` directly (a plain header import always resolves
// via the header search path react-native-callkeep's own Expo config plugin
// adds — see @config-plugins/react-native-callkeep — regardless of whether
// that pod has Swift module-map support, which this project can't assume).
@interface HitchlinkVoipPushDelegate : NSObject <PKPushRegistryDelegate>

@property (class, nonatomic, readonly) HitchlinkVoipPushDelegate *shared;

- (void)register;

@end

NS_ASSUME_NONNULL_END
