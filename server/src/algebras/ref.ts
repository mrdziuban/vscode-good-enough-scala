import { Lazy } from "fp-ts/lib/function";
import { Type, URIS } from "fp-ts/lib/HKT";

export interface Ref<F extends URIS, A> {
  read: Type<F, A>;
  write: (a: A) => Type<F, void>;
  modify(f: (a: A) => A): Type<F, void>;
}

export type MkRef<F extends URIS> = <A>(a: A) => Ref<F, A>;

export const lazyRef = <F extends URIS>(fromLazy: <A>(a: Lazy<A>) => Type<F, A>) => <A>(a: A): Ref<F, A> => {
  let value = a;
  return {
    read: fromLazy(() => value),
    write: (v: A) => fromLazy(() => { value = v; }),
    modify: (f: (a: A) => A) => fromLazy(() => { value = f(value); })
  };
};
