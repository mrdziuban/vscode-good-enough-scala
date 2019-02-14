export const applyTo = <A, B>(f: (a: A) => B) => (a: A): B => f(a);

export const exhaustive = (a: never): never => a;

export const now = () => (new Date()).getTime();

export function pipe<A, B, C>(f1: (a: A) => B, f2: (b: B) => C): (a: A) => C;
export function pipe<A, B, C, D>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D): (a: A) => D;
export function pipe<A, B, C, D, E>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E): (a: A) => E;
export function pipe<A, B, C, D, E, F>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F): (a: A) => F;
export function pipe<A, B, C, D, E, F, G>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G): (a: A) => G;
export function pipe<A, B, C, D, E, F, G, H>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H): (a: A) => H;
export function pipe<A, B, C, D, E, F, G, H, I>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I): (a: A) => I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I, f9: (i: I) => J): (a: A) => J;
export function pipe<A, B, C, D, E, F, G, H, I, J, K>(f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I, f9: (i: I) => J, f10: (j: J) => K): (a: A) => K;
export function pipe(...args: ((x: any) => any)[]): (a: any) => any {
  return (a: any) => args.reduce((acc: any, f: (x: any) => any) => f(acc), a);
}

export const prop = <K extends PropertyKey>(k: K) => <A extends Record<K, any>>(a: A): A[K] => a[k];

export const tap = <A>(f: (a: A) => void) => (a: A): A => { f(a); return a; };

export const withOpt = <A, O>(fn: (a: A) => O) => (a?: A): O | undefined => a ? fn(a) : undefined;
