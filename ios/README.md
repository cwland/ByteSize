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

## TestFlight releases

Pushing a tag like `ios-v0.10.0` runs `.github/workflows/ios-testflight.yml` on GitHub's Xcode 27 runner: it makes the
project, archives a Release build signed automatically with an App Store Connect API key, and uploads it to TestFlight.
The tag sets the version; the run number sets the build number. Pushes that touch `ios/` run `ios-test.yml` (tests and
an unsigned simulator build) instead.

Set these once under the repository's Settings › Secrets and variables › Actions (nothing personal goes in the repo):

| Name | Kind | What |
|---|---|---|
| `APPLE_TEAM_ID` | secret | your Apple developer Team ID |
| `ASC_KEY_ID` | secret | App Store Connect API key ID (Admin role) |
| `ASC_ISSUER_ID` | secret | App Store Connect issuer ID |
| `ASC_KEY_P8_BASE64` | secret | `base64 -i AuthKey_<id>.p8` |
| `PASSKEY_DOMAIN` | variable | your ByteSize server's host name |

```
git tag ios-v0.10.0
git push origin ios-v0.10.0
```
