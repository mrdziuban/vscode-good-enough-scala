import * as fc from "fast-check";
import { Lazy } from "fp-ts/lib/function";
import { io, IO } from "fp-ts/lib/IO";
import { IORef } from "fp-ts/lib/IORef";
import { Algebras } from "../src/algebras";
import { Analytics } from "../src/algebras/analytics";
import { CodeActions } from "../src/algebras/codeActions";
import { defaultFileCache, FileCache, Files } from "../src/algebras/files";
import { defaultLog, Log } from "../src/algebras/log";
import { MkRef } from "../src/algebras/ref";
import { defaultSettings, defaultSettingsT, Settings } from "../src/algebras/settings";
import { defaultStore, Store } from "../src/algebras/store";
import { Symbols } from "../src/algebras/symbols";
import { regexSymbols } from "../src/algebras/symbols/regex";

export const arbSpaces = fc.stringOf(fc.constant(' '), 2, 20);

type IOU = typeof io.URI;

export const ioFromLazy = <A>(f: Lazy<A>) => new IO(f);
export const ioRef: MkRef<IOU> = <A>(a: A) => new IORef(a);

export const noop = () => {}; // tslint:disable-line empty-block

export const algebras = (sources: FileCache, shouldLog: boolean = false): Algebras<IOU> => {
  const analytics: Analytics<IOU> = {
    trackEvent: (_c: string, _a: string, _l?: string, _v?: number) => io.of(undefined),
    trackTiming: (_c: string, _a: string, _d: number) => io.of(undefined)
  };
  const codeActions: CodeActions<IOU> = { all: io.of([]) };
  const files: Files<IOU> = defaultFileCache(io, ioRef)(() => io.of(sources));
  const log: Log<IOU> = shouldLog ? defaultLog(console, ioFromLazy) : defaultLog({ info: noop, warn: noop, error: noop }, ioFromLazy);
  const settings: Settings<IOU> = defaultSettings(io, ioRef)(() => io.of(defaultSettingsT));
  const symbols: Symbols<IOU> = regexSymbols(io, ioRef);
  const store: Store<IOU> = defaultStore(io, analytics, files, log, symbols);

  return { analytics, codeActions, files, log, settings, store, symbols };
}

const aCharCode = "A".charCodeAt(0);

export const aToZ = Array.from({ length: 26 }, (_, i: number) => String.fromCharCode(aCharCode + i));

export const arbAlphaChar = fc.oneof<string>(...aToZ.map((c: string) => fc.constant(c)));
export const arbStr = arbAlphaChar.chain((c: string) => fc.hexaString(5, 10).map((s: string) => c + s));

export const stripMargin = (s: string): string =>
  s.split("\n").map((l: string) => l.replace(/^\s*\|/, "")).join("\n");
