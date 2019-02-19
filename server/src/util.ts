export const isPromise = <A>(a: {}): a is PromiseLike<A> =>
  Object.prototype.hasOwnProperty.call(a, "then") && typeof (<any>a).then === "function";
export const now = () => +(new Date());
export const withOpt = <A, O>(fn: (a: A) => O) => (a?: A): O | undefined => a ? fn(a) : undefined;
