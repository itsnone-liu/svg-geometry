export interface Rat { p: bigint; q: bigint }

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) { const r = a % b; a = b; b = r; }
  return a || 1n;
}

export function rat(p: bigint, q = 1n): Rat {
  if (q === 0n) throw new Error("zero denominator");
  if (q < 0n) { p = -p; q = -q; }
  const g = gcd(p, q);
  return { p: p / g, q: q / g };
}

export const ZERO = rat(0n);
export function add(a: Rat, b: Rat): Rat { return rat(a.p * b.q + b.p * a.q, a.q * b.q); }
export function sub(a: Rat, b: Rat): Rat { return rat(a.p * b.q - b.p * a.q, a.q * b.q); }
export function mul(a: Rat, b: Rat): Rat { return rat(a.p * b.p, a.q * b.q); }
export function div(a: Rat, b: Rat): Rat {
  if (b.p === 0n) throw new Error("divide by zero");
  return rat(a.p * b.q, a.q * b.p);
}
export function neg(a: Rat): Rat { return { p: -a.p, q: a.q }; }
export function cmp(a: Rat, b: Rat): number {
  const d = a.p * b.q - b.p * a.q;
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}
export function eq(a: Rat, b: Rat): boolean { return a.p === b.p && a.q === b.q; }
export function toNumber(a: Rat): number { return Number(a.p) / Number(a.q); }
export function key(a: Rat): string { return `${a.p}/${a.q}`; }
