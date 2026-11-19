# ByteSize for iPhone

SwiftUI app (iOS 17+). All logic is in the `ByteSizeKit` Swift package; the `ByteSize` target is views only.
Design: `docs/superpowers/specs/2026-11-19-bytesize-ios-design.md`.

```
cd ios
cp Local.xcconfig.example Local.xcconfig     # once, for device builds (team id)
xcodegen generate                            # makes ByteSize.xcodeproj (not committed)
(cd ByteSizeKit && swift test)               # fast logic tests
xcodebuild test -scheme ByteSize -destination 'platform=iOS Simulator,name=iPhone 17'
open ByteSize.xcodeproj                      # run on your iPhone from Xcode
```

Theme colors are generated from the web app: `cd frontend && npx tsx ../scripts/gen-ios-theme.ts`.
