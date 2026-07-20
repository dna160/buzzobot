/**
 * Small deterministic PRNG (mulberry32). Seeded so fixture data is stable
 * across runs — essential for reproducible demos, snapshot tests, and
 * screenshot diffing. Never use this for anything security-sensitive.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Float in [min, max]. */
  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Pick a random element. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  /** Gaussian-ish value via central limit, clamped to [0, 1]. */
  bell(): number {
    const v = (this.next() + this.next() + this.next()) / 3;
    return Math.min(1, Math.max(0, v));
  }
}

/** Derive a stable numeric seed from an arbitrary string. */
export const seedFrom = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
