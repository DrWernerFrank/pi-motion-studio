import { doctor } from '../doctor.mjs';
export default async () => {
  const r = await doctor();
  const bad = r.items.filter((i) => i.required && !i.ok).map((i) => i.id);
  return { pass: r.ok, measured: r.ok ? `${r.items.length} probes ok` : `red: ${bad.join(', ')}` };
};
