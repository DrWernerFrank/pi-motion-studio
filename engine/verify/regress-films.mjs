import { compare } from '../regress.mjs';
export default async () => {
  const r = await compare();
  return { pass: r.pass, measured: r.pass ? Object.values(r.measured).join(' | ') : r.rows.join(' | ') };
};
