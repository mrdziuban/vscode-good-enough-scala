import { Lazy } from "fp-ts/lib/function";
import { Type } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { none, Option, some, tryCatch } from "fp-ts/lib/Option";
import { task, Task as TaskStrict } from "fp-ts/lib/Task";
import { Connection } from "vscode-languageserver";
import { Algebras } from "./algebras";
import { Analytics, timed } from "./algebras/analytics";
import { ga } from "./algebras/analytics/ga";
import { CodeActions, defaultCodeActions } from "./algebras/codeActions";
import { defaultFileCache, FileCache, Files } from "./algebras/files";
import { defaultLog, Log } from "./algebras/log";
import { lazyRef, MkRef } from "./algebras/ref";
import { defaultSettings, Settings } from "./algebras/settings";
import { defaultStore, Store } from "./algebras/store";
import { Symbols } from "./algebras/symbols";
import { regexSymbols } from "./algebras/symbols/regex";
import { Do, path } from "./util";

class Task<A> extends TaskStrict<A> {
  static fromLazy = <A>(f: Lazy<A>): Task<A> => new Task(() => Promise.resolve(f()));
  static fromPromiseL = <A>(f: Lazy<PromiseLike<A>>) => new Task(f);
  constructor(run: Lazy<PromiseLike<A>>) { super(<Lazy<Promise<A>>>(<unknown>run)); }
}

export type MHK = typeof task.URI;
export type M<A> = Type<MHK, A>;

export const M: Monad1<MHK> = task;
export const fromLazy: <A>(f: Lazy<A>) => M<A> = Task.fromLazy;
export const fromPromiseL: <A>(f: Lazy<PromiseLike<A>>) => M<A> = Task.fromPromiseL;
export const mkRef: MkRef<MHK> = lazyRef(fromLazy);

type RunMDeps = [Algebras<MHK>, string, string]

const runM = (ao: Option<RunMDeps>) => <A>(f: () => M<A>): PromiseLike<A> =>
  f().run().catch((e: any) => Do(M)<A>(function*() {
    yield ao.foldL(() => defaultLog(console, Task.fromLazy), path(0, "log")).error("Error running effect:", e);
    yield ao.fold(M.of(undefined), ([a, action, category]: RunMDeps) => a.analytics.trackEvent("error", `${action}.${category}`));
    return yield M.of(Promise.reject<A>(e));
  }).run());

export const RTS = {
  run: (a: Algebras<MHK>) => (action: string, category: string) => <A>(f: () => M<A>): PromiseLike<A> =>
    runM(some<RunMDeps>([a, action, category]))(() => timed(M, a.analytics)(category, action)(f)),
  runUntimed: <A>(f: M<A>): PromiseLike<A> => runM(none)(() => f)
};

const unsafeLogFn = (f: (s: string) => void) => (s: string, ...args: any[]) =>
  f([s].concat(args.map((a: any) => tryCatch(() => JSON.stringify(a, undefined, 2)).getOrElse(a.toString()))).join("\n"));

const unsafeLog = (connection: Connection) => ({
  info: unsafeLogFn(connection.console.log.bind(connection.console)),
  warn: unsafeLogFn(connection.console.warn.bind(connection.console)),
  error: unsafeLogFn(connection.console.error.bind(connection.console))
});

export const getAlgebras = (connection: Connection): M<Algebras<MHK>> => Do(M)(function*() {
  const machineId: string = yield fromPromiseL(() => connection.sendRequest(<string>("goodEnoughScalaMachineId")));
  const log: Log<MHK> = defaultLog(unsafeLog(connection), Task.fromLazy);
  const settings: Settings<MHK> = defaultSettings(M, mkRef)(() =>
    fromPromiseL(() => connection.workspace.getConfiguration("goodEnoughScala")));
  const analytics: Analytics<MHK> = ga(M, settings, mkRef, machineId);
  const files: Files<MHK> = defaultFileCache(M, mkRef)((o: Option<string[]>) => fromPromiseL(() => o.foldL(
    () => connection.sendRequest<FileCache>("goodEnoughScalaGetAllFiles"),
    (uris: string[]) => connection.sendRequest<FileCache>("goodEnoughScalaGetFiles", { uris }))));
  const symbols: Symbols<MHK> = regexSymbols(M, mkRef);
  const codeActions: CodeActions<MHK> = defaultCodeActions(M, analytics, files);
  const store: Store<MHK> = defaultStore(M, analytics, files, log, symbols);

  return { settings, analytics, files, log, symbols, store, codeActions };
});
