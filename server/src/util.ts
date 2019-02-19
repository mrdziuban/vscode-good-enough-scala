export const now = () => +(new Date());
export const withOpt = <A, O>(fn: (a: A) => O) => (a?: A): O | undefined => a ? fn(a) : undefined;
