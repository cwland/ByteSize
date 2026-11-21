# ByteSize for iPhone

SwiftUI app (iOS 17+). All logic is in the `ByteSizeKit` Swift package; the `ByteSize` target is views only.

```
cd ios
cp Local.xcconfig.example Local.xcconfig     # once: your team id and server address
xcodegen generate                            # makes ByteSize.xcodeproj (not committed)
(cd ByteSizeKit && swift test)               # fast logic tests
xcodebuild test -scheme ByteSize -destination 'platform=iOS Simulator,name=iPhone 17'
open ByteSize.xcodeproj                      # run on your iPhone from Xcode
```

Theme colors are generated from the web app: `cd frontend && npx tsx ../scripts/gen-ios-theme.ts`.

Passkeys on the phone need your server's address in `Local.xcconfig` (`PASSKEY_DOMAIN`), and the server
needs `IOS_APP_ID` set (see the main README). Without them the app still signs in with a password.
