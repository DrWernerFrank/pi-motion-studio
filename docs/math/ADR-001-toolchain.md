# ADR-001 — Manim toolchain, rootless (S1)

**Decision.** Manim Community 0.21.0 runs in its own venv `~/.local/share/pi-motion-studio/manim-venv`
(CPython 3.12.14 via uv), built **rootless**: pycairo 1.29.1 and manimpango 0.7.0 compiled from sdist
against a user-space sysroot of Ubuntu 26.04 `libcairo2-dev libpango1.0-dev pkgconf` closure packages
(61 debs, 103 MB extracted to `~/.local/share/pi-motion-studio/sysroot`). Wheels are cached in
`~/.cache/pi-motion-studio/wheels/` so a venv rebuild never recompiles (`uv pip install --no-index
--find-links`). Route (1) of the mission's S1 order (route 0 — the human's packages — was checked and
absent; route 2 — the tarball exception — was never needed).

**Evidence.**
- Route 0 probe (2026-10-03): `pkg-config`, `latex`, `dvisvgm`, `kpsewhich`, `cmake`, `meson`, `ninja` all
  MISSING; no passwordless sudo; gcc 15.2 / g++ / make present; runtime `libcairo2`, `libpango-1.0-0`,
  `libpangocairo-1.0-0` present.
- Attempt 1 (honest plain install, after the network was fixed — see below): `uv pip install manim`
  resolves, downloads, then fails building `manimpango` 0.7.0: `cc … cmanimpango.c … fatal error:
  cairo.h: No such file or directory` (log `~/.cache/pi-motion-studio/logs/s1-attempt1.log`). pycairo
  1.29.1 (meson-python) would fail the same way.
- Sysroot: `apt-get install -s` resolved the closure to 61 NEW packages (23.2 MB of debs, fetched with
  `apt-get download`, signature-verified by apt); `dpkg-deb -x` into the sysroot. The sysroot's 53
  dangling `-dev` `.so` symlinks (their runtime targets are the already-installed system libs, same
  distro/versions) were re-pointed at the system `.so.N` files — one special case: `libpng.so` → the
  system `libpng16.so.16.57.0`.
- Build env: `PKG_CONFIG=$SYS/usr/bin/pkgconf`, `PKG_CONFIG_PATH/LIBDIR` into the sysroot's pkgconfig
  dirs, `CPATH`/`LIBRARY_PATH`/`LD_LIBRARY_PATH` into the sysroot, build venv with `meson-python 0.22.1
  meson 1.12.1 ninja 1.13.2 Cython 3.0.12 setuptools 84.0.0 wheel 0.48.0 pip 26.2.1`.
  **No `PKG_CONFIG_SYSROOT_DIR`**: the sysroot's `.pc` files were patched to carry absolute sysroot
  paths instead — with the sysroot var, meson also prefixed *Python's* own `python-3.12-embed` lookup
  (`…uv/python/…/lib/pkgconfig/../../include/python3.12`) with the sysroot and the build died on
  `Python.h: No such file`.
  Manimpango 0.7.0 (spec said "Cython<3"; measured reality: `pyproject.toml` asks `Cython>=3.0.2,<3.1`,
  setuptools≥59.2) locates pango via the `PKG_CONFIG` env var honored by its `setup.py`.
- Wheels built: `pycairo-1.29.1-cp312-cp312-linux_x86_64.whl` (sha256 d59ea598…ff37),
  `manimpango-0.7.0-cp312-cp312-linux_x86_64.whl` (sha256 e895a4a1…7a31) → `manim==0.21.0` +
  30 pure wheels installed cleanly.
- Acceptance probe: `Text` (Pango) + `NumberPlane` + one animated `Square` rendered headless to MP4 —
  h264, yuv420p, duration exactly 3.000 s at 480p15, Manim's partial-movie files working
  (`~/.cache/pi-motion-studio/scratch/s1-probe/`).

**Consequence.** `studio doctor` probes Manim via `pythonFor('manim')` (`STUDIO_MANIM_PYTHON` env or
the venv) and the wheels+sysroot mean the studio never needs root to rebuild. At runtime the built
extensions resolve `libcairo.so.2`/`libpango*` from the **system** libs (same versions; no
`LD_LIBRARY_PATH` needed — verified by importing manim in a clean env). TeX is NOT installed: typesetting
is S2's decision (probe scene uses Pango `Text` only). The venv is frozen in
`engine/manim/requirements.lock`.

## The PyPI DNS gap (found during S1, affects every install)

`files.pythonhosted.org` (Fastly — the host that serves every PyPI wheel) returns **no DNS record** from
this machine's resolver (`10.255.255.254`, WSL's NAT proxy), while `pypi.org` resolves; npmjs too. The
host is perfectly reachable by IP: `curl --resolve files.pythonhosted.org:443:151.101.0.223` fetches a
real wheel with a valid TLS cert. Mirrors tested: tuna/aliyun/tencent unreachable, nju 404. Fix (no
root needed): a loopback CONNECT proxy `~/.cache/pi-motion-studio/scratch/pypi-proxy.mjs` that answers
`CONNECT files.pythonhosted.org` on pinned Fastly anycast IPs and resolves everything else normally —
end-to-end TLS is untouched (client still verifies certs). Use for every PyPI fetch:

    node ~/.cache/pi-motion-studio/scratch/pypi-proxy.mjs &   # port 3143, 127.0.0.1 only
    HTTPS_PROXY=http://127.0.0.1:3143 uv pip install …

`curl`/`apt`/`npm` are unaffected; only Python package installs need the proxy.
