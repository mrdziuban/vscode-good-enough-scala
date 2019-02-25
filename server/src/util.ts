import { Applicative1 } from "fp-ts/lib/Applicative";
import { Chain1, flatten } from "fp-ts/lib/Chain";
import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { Traversable1 } from "fp-ts/lib/Traversable";
import { TraversableWithIndex1 } from "fp-ts/lib/TraversableWithIndex";

export const applyTo = <A, B>(f: (a: A) => B) => (a: A): B => f(a);

export const autobind = <A extends object>(a: A): A => new Proxy(a, {
  get: <K extends keyof A>(target: A, key: K, receiver: any): A[K] =>
    applyTo((res: A[K]) => typeof res === "function" ? res.bind(receiver) : res)(target[key])
  });

export const concat = (a: string, b: string) => a + b;

export const dec = (i: number) => i + 1;
  export const inc = (i: number) => i + 1;

// tslint:disable-next-line variable-name
export const Do = <F extends URIS>(F: Monad1<F>) => <A>(generator: () => Iterator<any>): Type<F, A> => {
  const iterator = generator();
  const run = (s: IteratorResult<Type<F, A>>): Type<F, A> =>
    s.done ? F.of(<A>(<unknown>s.value)) : F.chain(s.value, (a: A) => run(iterator.next(a)));
  return run(iterator.next());
};

export const exhaustive = (a: never): never => a;

export const flip = <A, B, C>(f: (a: A, b: B) => C) => (b: B, a: A): C => f(a, b);

export const groupByArr = <A>(f: (a: A) => string) => (as: A[]): { [k: string]: A[] } =>
  as.reduce((acc: { [k: string]: A[] }, a: A) => {
    const k = f(a);
    return Object.assign({}, acc, { [k]: (acc[k] || []).concat([a]) });
  }, {});

export const now = () => (new Date()).getTime();

export const ord = (i1: string | number, i2: string | number) => i1 < i2 ? -1 : (i1 === i2 ? 0 : 1);
export const ordAll = <A>(...[f, fs]: [(a: A) => string | number, ...((a: A) => string | number)[]]) => (a1: A, a2: A): -1 | 0 | 1 =>
  [f].concat(fs).reduce((acc: -1 | 0 | 1, fn: (a: A) => string | number) => acc === 0 ? ord(fn(a1), fn(a2)) : acc, ord(f(a1), f(a2)));

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

type PK = PropertyKey;
type R<K extends PK, V> = Record<K, V>;

export function path<K1 extends PK, K2 extends PK>(...[k1, k2]: [K1, K2]): <A extends R<K1, R<K2, any>>>(a: A) => A[K1][K2];
export function path<K1 extends PK, K2 extends PK, K3 extends PK>(...[k1, k2, k3]: [K1, K2, K3]): <A extends R<K1, R<K2, R<K3, any>>>>(a: A) => A[K1][K2][K3];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK>(...[k1, k2, k3, k4]: [K1, K2, K3, K4]): <A extends R<K1, R<K2, R<K3, R<K4, any>>>>>(a: A) => A[K1][K2][K3][K4];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK, K5 extends PK>(...[k1, k2, k3, k4, k5]: [K1, K2, K3, K4, K5]): <A extends R<K1, R<K2, R<K3, R<K4, R<K5, any>>>>>>(a: A) => A[K1][K2][K3][K4][K5];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK, K5 extends PK, K6 extends PK>(...[k1, k2, k3, k4, k5, k6]: [K1, K2, K3, K4, K5, K6]): <A extends R<K1, R<K2, R<K3, R<K4, R<K5, R<K6, any>>>>>>>(a: A) => A[K1][K2][K3][K4][K5][K6];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK, K5 extends PK, K6 extends PK, K7 extends PK>(...[k1, k2, k3, k4, k5, k6, k7]: [K1, K2, K3, K4, K5, K6, K7]): <A extends R<K1, R<K2, R<K3, R<K4, R<K5, R<K6, R<K7, any>>>>>>>>(a: A) => A[K1][K2][K3][K4][K5][K6][K7];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK, K5 extends PK, K6 extends PK, K7 extends PK, K8 extends PK>(...[k1, k2, k3, k4, k5, k6, k7, k8]: [K1, K2, K3, K4, K5, K6, K7, K8]): <A extends R<K1, R<K2, R<K3, R<K4, R<K5, R<K6, R<K7, R<K8, any>>>>>>>>>(a: A) => A[K1][K2][K3][K4][K5][K6][K7][K8];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK, K5 extends PK, K6 extends PK, K7 extends PK, K8 extends PK, K9 extends PK>(...[k1, k2, k3, k4, k5, k6, k7, k8, k9]: [K1, K2, K3, K4, K5, K6, K7, K8, K9]): <A extends R<K1, R<K2, R<K3, R<K4, R<K5, R<K6, R<K7, R<K8, R<K9, any>>>>>>>>>>(a: A) => A[K1][K2][K3][K4][K5][K6][K7][K8][K9];
export function path<K1 extends PK, K2 extends PK, K3 extends PK, K4 extends PK, K5 extends PK, K6 extends PK, K7 extends PK, K8 extends PK, K9 extends PK, K10 extends PK>(...[k1, k2, k3, k4, k5, k6, k7, k8, k9, k10]: [K1, K2, K3, K4, K5, K6, K7, K8, K9, K10]): <A extends R<K1, R<K2, R<K3, R<K4, R<K5, R<K6, R<K7, R<K8, R<K9, R<K10, any>>>>>>>>>>>(a: A) => A[K1][K2][K3][K4][K5][K6][K7][K8][K9][K10];
export function path(...ks: any[]): (a: any) => any {
  return (a: any) => ks.reduce((acc: any, k: any) => acc[k], a);
}

export const prop = <K extends PK>(k: K) => <A extends R<K, any>>(a: A): A[K] => a[k];

export const reject = <A>(f: (a: A) => boolean) => (as: A[]): A[] => as.filter((a: A) => !f(a));

export const split = (splitter: string) => (s: string) => s.split(splitter);

export const tap = <A>(f: (a: A) => void) => (a: A): A => { f(a); return a; };

export const traverseM = <F extends URIS>(F: Traversable1<F> & Chain1<F>) => <G extends URIS>(G: Applicative1<G>) =>
  <A, B>(fa: Type<F, A>, f: (a: A) => Type<G, Type<F, B>>): Type<G, Type<F, B>> => F.map(F.traverse(G)(fa, f), flatten(F));

export const traversewithIndexM = <F extends URIS>(F: TraversableWithIndex1<F, number> & Chain1<F>) => <G extends URIS>(G: Applicative1<G>) =>
  <A, B>(fa: Type<F, A>, f: (i: number, a: A) => Type<G, Type<F, B>>): Type<G, Type<F, B>> => F.map(F.traverseWithIndex(G)(fa, f), flatten(F));
