import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { Do, now } from "../../util";

export interface Analytics<M extends URIS> {
  trackEvent: (category: string, action: string, label?: string, value?: number) => Type<M, void>;
  trackTiming: (category: string, action: string, duration: number) => Type<M, void>;
}

export const timed = <M extends URIS>(M: Monad1<M>, a: Analytics<M>) => (category: string, action: string) => <A>(fn: () => Type<M, A>): Type<M, A> =>
  Do(M)(function*() {
    const start = now();
    const res = yield fn();
    yield Array.isArray(res) ? a.trackEvent(category, action, "results", res.length) : a.trackEvent(category, action);
    yield a.trackTiming(category, action, now() - start);
    return res;
  });
