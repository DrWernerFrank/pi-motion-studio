# Third-party downloads (math mission)

Everything the math pipeline downloads, with license and integrity note. Nothing here needs an account;
nothing is installed system-wide (no sudo). Scratch/caches: `~/.cache/pi-motion-studio/`,
data: `~/.local/share/pi-motion-studio/`.

## Ubuntu archive packages → user-space sysroot (ADR-001)

61 debs (23.2 MB) of the `libcairo2-dev libpango1.0-dev pkgconf` closure, Ubuntu 26.04 `resolute`
from `archive.ubuntu.com` (apt's signed package lists verify each download; the WSL DNS gap does not
affect apt). Fetched with `apt-get download` (no root), extracted with `dpkg-deb -x` into
`~/.local/share/pi-motion-studio/sysroot`. Licenses: the packages' own (LGPL/GPL/MIT — the canonical
Ubuntu licence files are inside each deb's `/usr/share/doc/<pkg>/copyright`).
List: `gir1.2-* dev` packages, `icu-devtools`, `libblkid/brotli/bz2/cairo/datrie/expat/ffi/fontconfig/
freetype/fribidi/gio/glib/graphite2/harfbuzz/ice/icu/mount/pango/pcre2/pixman/pkgconf(png-dev:libpkgconf7)
/selinux/sepol/sm/sysprof/thai/x11/xau/xcb/xdmcp/xext/xft/xrender` dev packages, `pango1.0-tools`,
`native-architecture`, `pkgconf`, `pkgconf-bin`, `uuid-dev`, `x11proto-dev`, `xorg-sgml-doctools`,
`xtrans-dev`, `zlib1g-dev`. Deb files kept in `~/.cache/pi-motion-studio/scratch/s1-debs/`.

## PyPI wheels (via the loopback proxy — see ADR-001 for the DNS gap)

- **pycairo 1.29.1** — built here from sdist (LGPL-2.1-only OR MPL-1.1).
  `pycairo-1.29.1-cp312-cp312-linux_x86_64.whl` sha256 `d59ea598c466d0a11a7c8bd87f8e45fa77668415c8e2996886191f892e42ff37`
- **manimpango 0.7.0** — built here from sdist (MIT).
  `manimpango-0.7.0-cp312-cp312-linux_x86_64.whl` sha256 `e895a4a10b5db98d3ca1a00531c4caa883192e73f0748b4bb35ae69a5cfa7a31`
- **manim 0.21.0** + its 30 pure wheels (MIT and their own licenses) — installed from PyPI, frozen in
  `engine/manim/requirements.lock`.

## Models, voices, fonts (S2–S4 land here)

- faster-whisper `small` int8 + Piper voices (`en_US-ljspeech-medium`,
  `en_GB-northern_english_male-medium`, `fa_IR-amir-medium`) + the RNNoise model: already present from
  the editing mission (see `docs/editing/THIRD_PARTY.md`), reused, not re-downloaded.
- (nothing else yet)

## S2 measurements (downloaded, measured, then removed — ADR-002)

- **TinyTeX-1-linux-x86_64 v2026.10** (TeX Live 2026, GPL/TeX licenses):
  https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/TinyTeX-1-linux-x86_64-v2026.10.tar.xz
  sha256 `4d519d6236ee6798e3ec0d8e2093d1fda01aeb267aa22c2a5586d76bcfce6566`.
  Used to measure the LaTeX route (40/40 with a lean template after `tlmgr install dvisvgm standalone
  preview xcolor` from mirror.ctan.org). Not the default backend; the installed tree was removed.
- **tex2typst 0.6.2** (npm, Apache-2.0): the LaTeX→Typst math converter inside the studio's `Eq`
  wrapper. https://www.npmjs.com/package/tex2typst

## S3 voice measurements (ADR-003)

- **piper-tts[alignment]** (extra `onnx` 1.23.1 + `ml-dtypes` + `protobuf`, from PyPI, BSD/Apache/MIT):
  installed into the ML venv to enable Piper's in-memory alignment patch.
- **kokoro-onnx 0.6.1** (pypi, Apache-2.0) + **kokoro v1.0 model** (onnx 325.5 MB + voices 28.2 MB,
  Apache-2.0, https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/
  kokoro-v1.0.onnx and …/voices-v1.0.bin): measured (WER 0.6%, 2.9× realtime, no word timings, no
  Persian), kept installed as the optional fallback voice.
  kokoro-v1.0.onnx sha256 `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5`,
  voices-v1.0.bin sha256 `bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d`.
- Reused from the editing mission (no re-download): piper voices `en_US-ljspeech-medium`,
  `en_GB-northern_english_male-medium`, `fa_IR-amir-medium`; faster-whisper `small`.
