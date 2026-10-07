// doctor.mjs — chart's probe (K12): `doctor(ctx)` returns [{id, label, ok, detail}] rows, the
// same shape engine/doctor.mjs uses. This scaffold probe is REAL (it reports the contract parts
// on disk); grow it into the technique's actual readiness checks (missing binaries, fonts, data
// sources…). engine/produce/capabilities.mjs's PROBES does not know the id "chart" yet, so the
// catalog entry ships ready: "chart" — an UNKNOWN probe id, which `studio capabilities` honestly
// reports as NOT-READY ("add the probe … or set ready: 'yes'"). Point `ready` at a probe id the
// lead registers, or set ready: "yes" when the technique needs nothing.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (f) => existsSync(fileURLToPath(new URL(f, import.meta.url)));

export function doctor(ctx = {}) {
  void ctx;   // the context (engine/doctor.mjs style) — this probe needs none yet
  const parts = ['index.mjs', 'catalog.json', 'gates.mjs', 'SKILL.md', 'TOOLS.md'];
  const missing = parts.filter((p) => !here(p));
  return [
    { id: 'chart', label: 'chart contract parts', ok: missing.length === 0,
      detail: missing.length
        ? `missing: ${missing.join(', ')} (scaffold again, or restore the file)`
        : `${parts.length} parts on disk (index.mjs, catalog.json, gates.mjs, SKILL.md, TOOLS.md) — for the implementation state run: studio capability check chart` },
  ];
}
