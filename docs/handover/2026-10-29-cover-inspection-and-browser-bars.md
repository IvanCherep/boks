# Cover inspection and browser bars — 29 October 2026

The user asked for white branding over every illustration, a permanently
black upper native bar and a lower native bar following the interface theme.
They also asked to hold a cover to see its artwork at original brightness.

## Behaviour

- A stationary primary press on a free area of an illustrated cover activates
  inspection after 320ms. Cover text, controls, dock and both shading layers
  disappear. The same image and crop remain, without brightness filters.
- Release, pointer cancellation, capture loss, window blur, document hiding,
  a different bok or a blocking overlay ends the inspection. A movement over
  12px before activation cancels the timer, preserving swipes. Buttons and
  links are excluded. Activation clears the reader's pending swipe/tap state,
  so releasing an inspection does not change the bok or toggle controls.
- `reader/use-cover-inspection.ts` owns the temporary gesture and cleanup.
  Image dragging and iOS image callouts are disabled on illustrated covers.
  No new reader copy, stored preference or event type is introduced. Existing
  foreground reading and touch attribution rules remain unchanged.
- Illustrated reader headers always use cream white ink, including the
  desktop header. Obsolete per-cover `coverLogoTone` fields and cover/player
  native-colour overrides were removed. Images and crops are unchanged.
- Global mobile edge surfaces are independent of the book: black above,
  theme background below. Light and dark lower surfaces alternate display
  instead of recolouring one fixed renderer, which avoids Safari retaining
  its previous edge tint until reload. They occupy the safe-area edge, with
  a 6px minimum, accept no input and are absent on fine-pointer desktop UI.
  `theme-color` and the opaque Home Screen status-bar hint are black.

## Browser boundary

The website supplies the edge colours; a browser app decides how its own
native controls use them. WebKit describes the fixed-edge colour extension
in https://bugs.webkit.org/show_bug.cgi?id=301756. Apple's opaque black
status-bar meta applies to Home Screen mode, not ordinary tabs:
https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html.
Physical Arc/iPhone verification remains a device check.

## Validation

`npm run check`, `npm run build`, `npm run check:deploy-target` pass. No schema
or catalogue data change. Chromium and WebKit check six covers at 402×736,
320×568, 874×402 and 1440×900, including bright initial loads, resize stress,
white branding, black hints and both lower theme colours. Hold/release,
holding a button, blur cancellation and ordinary swipes pass. Chromium also
checks real touch hold/release and touch cancellation. Held image pixels are
compared to the unshaded source rendered at the same crop; average channel
differences are below 1/255 in both engines. Identity/feed fixtures intercept
requests; no production write is sent.

Safari on iOS 26.3 Simulator, iPhone 16e, shows a black upper native bar and
the matching light/dark lower bar. Settings → Appearance changes the lower
native bar in both directions without reload, while the top stays black.
The actual built app is served through a local fixture proxy, with synthetic
identity and bounded feed data. Screenshots and logs are in the ignored
`work/browser-chrome-2026-10-29/` directory.

Release details are recorded after production verification.
