import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { none } from "fp-ts/lib/Option";
import { Do, now } from "../util";
import { Analytics, timed } from "./analytics";
import { FileCache, Files } from "./files";
import { Log } from "./log";
import { ScalaSymbol, Symbols } from "./symbols";

export interface Store<M extends URIS> {
  indexFiles: (fileCache: FileCache) => Type<M, ScalaSymbol[]>;
  indexAllFiles: () => Type<M, ScalaSymbol[]>;
}

export const defaultStore = <M extends URIS>(M: Monad1<M>, A: Analytics<M>, F: Files<M>, L: Log<M>, S: Symbols<M>): Store<M> => {
  const indexFiles = (fileCache: FileCache): Type<M, ScalaSymbol[]> => Do(M)(function*() {
    const start = now();
    yield F.update(fileCache);
    const syms: ScalaSymbol[] = yield S.update(Object.values(fileCache));
    yield L.info(`Indexed ${Object.keys(syms).length} scala symbols in ${now() - start}ms`);
    return syms;
  });

  return {
    indexFiles,
    indexAllFiles: (): Type<M, ScalaSymbol[]> => timed(M, A)("action", "indexAll")(() => M.chain(F.getFiles(none), indexFiles)),
  };
};
