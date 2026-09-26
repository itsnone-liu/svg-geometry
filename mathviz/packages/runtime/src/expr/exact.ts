// Exact rational arithmetic on bigint — the deterministic exact track of the
// expression evaluator. Integers are rationals with q = 1n. Always normalized:
// q > 0, gcd(|p|, q) = 1.

export interface Rat {
  p: bigint;
  q: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function rat(p: bigint, q: bigint = 1n): Rat {
  if (q === 0n) throw new Error("rat: zero denominator");
  if (q < 0n) {
    p = -p;
    q = -q;
  }
  const g = gcd(p, q) || 1n;
  return { p: p / g, q: q / g };
}

export const ratZero: Rat = { p: 0n, q: 1n };

export function ratAdd(a: Rat, b: Rat): Rat {
  return rat(a.p * b.q + b.p * a.q, a.q * b.q);
}
export function ratSub(a: Rat, b: Rat): Rat {
  return rat(a.p * b.q - b.p * a.q, a.q * b.q);
}
export function ratMul(a: Rat, b: Rat): Rat {
  return rat(a.p * b.p, a.q * b.q);
}
export function ratDiv(a: Rat, b: Rat): Rat {
  if (b.p === 0n) throw new Error("ratDiv: zero denominator");
  return rat(a.p * b.q, a.q * b.p);
}
export function ratNeg(a: Rat): Rat {
  return { p: -a.p, q: a.q };
}
export function ratIsZero(a: Rat): boolean {
  return a.p === 0n;
}

/** Integer power. Negative exponent inverts (zero base is an error). */
export function ratPow(a: Rat, e: bigint): Rat {
  if (e < 0n) {
    if (a.p === 0n) throw new Error("ratPow: zero to negative power");
    return ratPow(rat(a.q, a.p), -e);
  }
  return rat(a.p ** e, a.q ** e);
}

export function ratToNumber(a: Rat): number {
  return Number(a.p) / Number(a.q);
}

export function ratEq(a: Rat, b: Rat): boolean {
  return a.p === b.p && a.q === b.q;
}
