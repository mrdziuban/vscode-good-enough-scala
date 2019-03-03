import { Lazy } from "fp-ts/lib/function";
import { Type, URIS } from "fp-ts/lib/HKT";

export interface Log<M extends URIS> {
  info: (s: string, ...args: any[]) => Type<M, void>;
  warn: (s: string, ...args: any[]) => Type<M, void>;
  error: (s: string, ...args: any[]) => Type<M, void>;
}

interface UnsafeLog {
  info: (s: string, ...args: any[]) => void;
  warn: (s: string, ...args: any[]) => void;
  error: (s: string, ...args: any[]) => void;
}

export const defaultLog = <M extends URIS>(L: UnsafeLog, fromLazy: (f: Lazy<void>) => Type<M, void>): Log<M> => ({
  info: (s: string, ...args: any[]) => fromLazy(() => L.info(s, ...args)),
  warn: (s: string, ...args: any[]) => fromLazy(() => L.warn(s, ...args)),
  error: (s: string, ...args: any[]) => fromLazy(() => L.error(s, ...args))
});
