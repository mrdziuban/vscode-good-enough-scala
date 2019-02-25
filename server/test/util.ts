import * as fc from "fast-check";
import { Lazy } from "fp-ts/lib/function";
import { identity, Identity } from "fp-ts/lib/Identity";
import { Algebras } from "../src/algebras";
import { Analytics } from "../src/algebras/analytics";
import { CodeActions } from "../src/algebras/codeActions";
import { defaultFileCache, FileCache, Files } from "../src/algebras/files";
import { defaultLog, Log } from "../src/algebras/log";
import { lazyRef, MkRef } from "../src/algebras/ref";
import { defaultSettings, defaultSettingsT, Settings } from "../src/algebras/settings";
import { defaultStore, Store } from "../src/algebras/store";
import { Symbols } from "../src/algebras/symbols";
import { regexSymbols } from "../src/algebras/symbols/regex";

type Id = typeof identity.URI;

export const arbSpaces = fc.stringOf(fc.constant(' '), 2, 20);

export const idFromLazy = <A>(f: Lazy<A>) => new Identity(f());
export const idRef: MkRef<Id> = lazyRef(idFromLazy);

export const noop = () => {}; // tslint:disable-line empty-block

export const algebras = (sources: FileCache, shouldLog: boolean = false): Algebras<Id> => {
  const analytics: Analytics<Id> = {
    trackEvent: (_c: string, _a: string, _l?: string, _v?: number) => identity.of(undefined),
    trackTiming: (_c: string, _a: string, _d: number) => identity.of(undefined)
  };
  const codeActions: CodeActions<Id> = { all: identity.of([]) };
  const files: Files<Id> = defaultFileCache(identity, idRef)(() => identity.of(sources));
  const log: Log<Id> = shouldLog ? defaultLog(console, idFromLazy) : defaultLog({ info: noop, warn: noop, error: noop }, idFromLazy);
  const settings: Settings<Id> = defaultSettings(identity, idRef)(() => identity.of(defaultSettingsT));
  const symbols: Symbols<Id> = regexSymbols(identity, idRef);
  const store: Store<Id> = defaultStore(identity, analytics, files, log, symbols);

  return { analytics, codeActions, files, log, settings, store, symbols };
}

const aCharCode = "A".charCodeAt(0);

export const aToZ = Array.from({ length: 26 }, (_, i: number) => String.fromCharCode(aCharCode + i));

export const arbAlphaChar = fc.oneof<string>(...aToZ.map((c: string) => fc.constant(c)));
export const arbStr = arbAlphaChar.chain((c: string) => fc.hexaString(5, 10).map((s: string) => c + s));

export const stripMargin = (s: string): string =>
  s.split("\n").map((l: string) => l.replace(/^\s*\|/, "")).join("\n");
