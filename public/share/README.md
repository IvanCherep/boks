# Share poster assets

The `/b/[id]/image` Worker route renders the same portrait composition as the
reader's Share bok card. It reads one published bok, never a catalogue dump.

`art/*.jpg` are JPEG copies of `public/series/*.webp` (same pixels and crop,
Pillow RGB, quality 90, optimize). Satori/Resvg cannot decode WebP. When adding
a Series cover, add its JPEG here too; the poster asset test checks the registry.

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
