# Share poster assets

The `/b/[id]/image` Worker route renders the same portrait composition as the
reader's Share bok card. It reads one published bok, never a catalogue dump.

`art/*.jpg` are JPEG copies of registered WebP covers; Satori/Resvg cannot
decode WebP. Series copies come from `public/series/` (Pillow RGB,
quality 90, optimize). The restored `dream-parting-kiss.jpg` uses Sharp,
JPEG quality 90, mozjpeg, from the matching WebP; its source is the first
scene in `public/poetry/dream-within-dream/`. Catalogue copies come from
`public/covers/`, with the same UUID basename (Sharp, JPEG quality 88,
mozjpeg). Both keep the source's 720×1280 pixels, without another crop or
resize. The shared artwork resolver selects the matching JPEG and authored
crop. When adding either kind of cover, add its JPEG here too; the poster
asset test checks both registries. New shares include the version from
`lib/boks/share-link.ts` so messengers can request the updated poster.

`fonts/source-serif-4-italic.ttf` combines static instances of the installed
`@fontsource-variable/source-serif-4` 5.3.0 standard italic Latin and Cyrillic
WOFF2 subsets: FontTools `instantiateVariableFont` with `wght=400, opsz=60`,
then `flavor=None` and `fontTools.merge.Merger` to combine their character maps.
The existing Source Serif licence is in `/licenses/source-serif-4-OFL.txt`.

`fonts/noto-sans.ttf` is Noto Sans from the Google Fonts `ofl/notosans`
repository, instantiated at `wght=400, wdth=100` and subset to U+0000–U+24FF.
This keeps Cyrillic bylines as well as Latin. Licence: `/licenses/noto-sans-OFL.txt`.

These static fonts avoid WOFF2 and variable-font decoding in the image renderer.
They are assets, not part of the reader's font downloads. The PNG is generated
on demand and cached for five minutes; publication is checked before the
Worker's image cache is read.
