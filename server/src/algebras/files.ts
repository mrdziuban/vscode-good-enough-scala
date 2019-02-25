import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { fromNullable, Option, some } from "fp-ts/lib/Option";
import { autobind, path, pipe, prop } from "../util";
import { MkRef } from "./ref";

export interface ScalaFile {
  uri: string;
  relativePath: string;
}

export interface File { uri: string; relativePath: string; contents: string; }
export interface FileCache { [uri: string]: File; }

export interface Files<M extends URIS> {
  update: (contents: FileCache) => Type<M, void>;
  getFiles: (uris: Option<string[]>) => Type<M, FileCache>;
  getFileContents: (uri: string) => Type<M, string>;
  getRelPath: (uri: string) => Type<M, string>;
  addJustChanged: (uri: string) => Type<M, void>;
  isJustChanged: (uri: string) => Type<M, boolean>;
}

export const defaultFileCache = <M extends URIS>(M: Monad1<M>, R: MkRef<M>) => (getFiles: (uris: Option<string[]>) => Type<M, FileCache>): Files<M> => {
  const cacheRef = autobind(R<FileCache>({}));
  const justChanged: { [uri: string]: boolean } = {};

  const getFromCache = <K extends keyof File>(key: K) => (uri: string): Type<M, File[K]> =>
    M.chain(cacheRef.read(), (cache: FileCache) => fromNullable(cache[uri]).foldL(
      () => M.map(getFiles(some([uri])), path(uri, key)),
      pipe(prop(key), M.of)));

  return {
    update: (contents: FileCache): Type<M, void> => cacheRef.modify((cache: FileCache) => Object.assign({}, cache, contents)),

    getFiles,
    getFileContents: getFromCache("contents"),
    getRelPath: getFromCache("relativePath"),

    addJustChanged: (uri: string): Type<M, void> => M.map(M.of(undefined), () => {
      justChanged[uri] = true;
      setTimeout(() => justChanged[uri] = false, 500);
    }),

    isJustChanged: (uri: string): Type<M, boolean> => M.of(!!justChanged[uri])
  };
};
