import { array, flatten } from "fp-ts/lib/Array";
import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { SymbolKind, TextDocumentPositionParams } from "vscode-languageserver";
import { applyTo, autobind, concat, dec, Do, flip, groupByArr, inc, ordAll, path, pipe, prop, reject, split } from "../../util";
import { File, Files, ScalaFile } from "../files";
import { MkRef } from "../ref";
import { ScalaSymbol, SymbolCache, Symbols, symName, symToUri, Term } from "../symbols";
import FuzzySearch = require("fuzzy-search");

type SymbolExtractor = (f: ScalaFile, c: string) => ScalaSymbol[];

export const regexSymbols = <M extends URIS>(M: Monad1<M>, R: MkRef<M>): Symbols<M> => {
  const extractMatches = (rx: RegExp, symbolType: string, kind: SymbolKind, file: ScalaFile) => (line: string, lineNum: number): ScalaSymbol[] => {
    const offset = symbolType.length + 1;
    const retVal: ScalaSymbol[] = [];
    let matches = rx.exec(line);
    while (!!matches) {
      retVal.push({
        name: symName(matches[1]),
        rawName: matches[1],
        kind,
        file,
        location: { line: lineNum, character: matches.index + offset }
      });
      matches = rx.exec(line);
    }
    return retVal;
  };

  const alphaRx = /[a-zA-Z]/;
  const termRx = new RegExp(`[${alphaRx.source.slice(1, -1)}0-9_]`);

  const defaultExtractor = (symType: string, kind: SymbolKind) => (file: ScalaFile, contents?: string): ScalaSymbol[] => {
    const rx = new RegExp(`${symType} (${alphaRx.source}${termRx.source}+)`, "g");
    return flatten((contents || "").split("\n").map(extractMatches(rx, symType, kind, file)));
  };

  const symbolExtractors: SymbolExtractor[] = [
    defaultExtractor("class", SymbolKind.Class),
    defaultExtractor("trait", SymbolKind.Interface),
    defaultExtractor("object", SymbolKind.Class),
    defaultExtractor("val", SymbolKind.Variable),
    defaultExtractor("def", SymbolKind.Function),
    defaultExtractor("type", SymbolKind.TypeParameter)
  ];

  const buildTerm = (charPos: number) => (line: string): Term => {
    const append = (updIdx: (i: number) => number, concatF: (char: string, term: string) => string) => (acc: string): [string, number] => {
      let pos = charPos;
      let idx = updIdx(charPos);
      while (line[idx] && termRx.test(line[idx])) {
        acc = concatF(line[idx], acc);
        pos = idx;
        idx = updIdx(idx);
      }
      return [acc, pos];
    };

    return pipe(
      append(dec, concat),
      ([term, start]: [string, number]): [number, [string, number]] => [start, append(inc, flip(concat))(term)],
      ([start, [term, end]]: [number, [string, number]]) => ({ term: symName(term), range: { start, end } }))(line[charPos]);
  };

  const extract = (files: File[]): ScalaSymbol[] => array.chain(files, (file: File) => {
    const scalaFile = { uri: file.uri, relativePath: file.relativePath };
    return array.chain(symbolExtractors, (ex: SymbolExtractor) => ex(scalaFile, file.contents));
  });

  const getTerm = (files: Files<M>) => (tdp: TextDocumentPositionParams): Type<M, Term> =>
    M.map(files.getFileContents(tdp.textDocument.uri), pipe(split("\n"), prop(tdp.position.line), buildTerm(tdp.position.character)));

  const cacheRef = autobind(R<SymbolCache>({}));

  const mkFuzzySearch = (syms: ScalaSymbol[]) => autobind(new FuzzySearch(syms, ["rawName"], { caseSensitive: false, sort: true }));
  const fuzzySearchRef = autobind(R(mkFuzzySearch([])));

  return {
    search: (query: string) => M.map(fuzzySearchRef.read(), (f: FuzzySearch<ScalaSymbol>) => f.search(query.toLowerCase())),

    update: (filesToIndex: File[]): Type<M, ScalaSymbol[]> => Do(M)(function*() {
      const oldCache: SymbolCache = yield cacheRef.read();
      const filesToRemove = filesToIndex.map(prop("uri"));
      const shouldRemove: { [f: string]: true } = Object.assign({}, ...Array.from(filesToRemove, (f: string) => ({ [f]: true })));
      const keptSyms = applyTo((xs: ScalaSymbol[]) => filesToRemove.length === 0 ? xs :
        xs.filter((s: ScalaSymbol) => !!!shouldRemove[s.file.uri]))(flatten(Object.values(oldCache)));
      const newSyms = extract(filesToIndex);
      const allSyms = newSyms.concat(keptSyms).sort(ordAll(symToUri, path("location", "character"), path("location", "line")));
      yield cacheRef.write(groupByArr<ScalaSymbol>(prop("name"))(allSyms));
      yield fuzzySearchRef.write(mkFuzzySearch(allSyms));
      return allSyms;
    }),

    getTerm,

    symbolsForPos: (files: Files<M>) => (tdp: TextDocumentPositionParams): Type<M, ScalaSymbol[]> => Do(M)(function*() {
      const term: Term = yield getTerm(files)(tdp);
      const syms: ScalaSymbol[] = yield M.map(cacheRef.read(), (cache: SymbolCache) => cache[term.term] || []);
      return reject((sym: ScalaSymbol) =>
        sym.file.uri === tdp.textDocument.uri && sym.location.line === tdp.position.line &&
        sym.location.character >= term.range.start && sym.location.character <= term.range.end)(syms);
    })
  };
};
