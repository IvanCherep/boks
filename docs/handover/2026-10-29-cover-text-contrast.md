# Cover text contrast — 29 October 2026

The user reported unreadable text on «Городок в табакерке» and «Кусака», and
provided The Jumblies, Eveline and «Колокольчик» as readable controls. They
asked whether the illustrations should all be regenerated with quiet areas
for text. The fix is in the interface: a picture cannot reserve one fixed area
for every title, summary, font and viewport.

## Implementation

- `components/boks/reader/cover-heading.tsx` retains the existing heading DOM
  and measures only the current cover, using a small ephemeral canvas. The
  source image is cropped as the reader crops it, and the original cover-wide
  shade is included. Samples come from the actual title, byline and visible
  summary line rectangles.
- A contrast estimate sets the opacity of a local gradient. Sampling tolerates
  a few specular highlights instead of making every dark scene black. This is
  a practical estimate, not a claim that every individual image pixel meets a
  contrast threshold. The reported bright covers need more shade; the tested
  «Колокольчик» needs none.
- The gradient follows the natural heading height, with fades outside the
  text. Image load and size changes recalculate its strength; an unavailable
  pixel read keeps a protective default. Analysis uses no network, storage or
  reader events, and stops when the heading changes or unmounts.
- A small text shadow helps glyph edges. No blur, opaque card or altered image
  is used. Existing wordmark/native-bar contrast, artwork, crop and reading
  measurements remain unchanged. Typographic covers receive no new gradient.

## Validation and release

`npm run check`, `npm run build` and `npm run check:deploy-target` pass. There
are no schema changes. Chromium and WebKit each checked six covers at
402×736, 320×568, 874×402 and 1440×900, with before/after screenshots and
unchanged heading geometry. A synthetic white-image stress case checks strong
protection and recalculation after resizing. Browser fixtures intercept the
identity and feed and block production writes.

App commit `5ad087d` was pushed to main and deployed with `--keep-vars`:
Worker `37d900ee-3a08-4f35-8122-7540b8b0d081`, https://tryboks.com.
The same checks pass against the production bundle in both browsers, including
the white-image/resize stress case. Wait for the measured shade condition in
that synthetic load test; two animation frames alone can precede WebKit's
image-load callback. CI passed for the app commit:
https://github.com/IvanCherep/boks/actions/runs/40928638541.
Local screenshots, fixtures and logs remain in the ignored work directory.
Physical iPhone/Arc verification remains the user's device check.
