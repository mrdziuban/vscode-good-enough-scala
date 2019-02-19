import { Location, SymbolKind, TextDocumentPositionParams } from "vscode-languageserver";
import { File, FileCache, Files, ScalaFile } from "./files";
import { applyTo, ordAll, path, pipe, prop } from "./util";
import FuzzySearch = require("fuzzy-search");
import R = require("rambda");

const symPrefix = "__SCALA_SYMBOL__";
const symName = (name: string) => `${symPrefix}${name}`;

export interface ScalaSymbol {
  name: string;
  rawName: string;
  kind: SymbolKind;
  file: ScalaFile;
  location: { line: number; character: number; };
}

export interface SymbolCache { [sym: string]: ScalaSymbol[]; }

type SymbolExtractor = (f: ScalaFile, c: string) => ScalaSymbol[];

const extractMatches = (rx: RegExp, symbolType: string, kind: SymbolKind, file: ScalaFile) => (line: string, lineNum: number): ScalaSymbol[] => {
  const offset = symbolType.length + 2;
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
  return R.flatten<ScalaSymbol>((contents || "").split("\n").map(extractMatches(rx, symType, kind, file)));
};

const symbolExtractors: SymbolExtractor[] = [
  defaultExtractor("class", SymbolKind.Class),
  defaultExtractor("trait", SymbolKind.Interface),
  defaultExtractor("object", SymbolKind.Class),
  defaultExtractor("val", SymbolKind.Variable),
  defaultExtractor("def", SymbolKind.Function),
  defaultExtractor("type", SymbolKind.TypeParameter)
];

interface CharRange { start: number; end: number; }
interface Term { term: string; range: CharRange; }

const buildTerm = (charPos: number) => (line: string): Term => {
  const append = (updIdx: (i: number) => number, concat: (char: string, term: string) => string) => (acc: string): [string, number] => {
    let pos = charPos;
    let idx = updIdx(charPos);
    while (line[idx] && termRx.test(line[idx])) {
      acc = concat(line[idx], acc);
      pos = idx;
      idx = updIdx(idx);
    }
    return [acc, pos];
  };

  return pipe(
    append(R.dec, R.concat),
    ([term, start]: [string, number]): [number, [string, number]] => [start, append(R.inc, R.flip<string, string, string>(R.concat))(term)],
    ([start, [term, end]]: [number, [string, number]]) => ({ term: symName(term), range: { start, end } }))(line[charPos]);
};

export class Symbols {
  private cache: SymbolCache = {};
  private files: Files;
  private fuzzySearch: FuzzySearch<ScalaSymbol> = Symbols.initFuzzySearch({});

  static init = (files: Files): Symbols => new Symbols(files);

  static initFuzzySearch = (syms: SymbolCache): FuzzySearch<ScalaSymbol> =>
    new FuzzySearch(R.flatten<ScalaSymbol>(Object.values(syms)), ["rawName"], { caseSensitive: false, sort: true })

  static symToUri = (sym: ScalaSymbol) => sym.file.uri;
  static symToLoc = (sym: ScalaSymbol) => Location.create(Symbols.symToUri(sym), { start: sym.location, end: sym.location });

  static extract = (files: FileCache): ScalaSymbol[] => R.flatten(Object.values(files).map((file: File) => {
    const scalaFile = { uri: file.uri, relativePath: file.relativePath };
    return R.flatten(symbolExtractors.map((ex: SymbolExtractor) => ex(scalaFile, file.contents)));
  }))

  constructor(files: Files) {
    this.files = files;
  }

  search = (query: string) => this.fuzzySearch.search(query.toLowerCase());

  updateCache = (newSyms: ScalaSymbol[], filesToRemove: string[]): SymbolCache => {
    const shouldRemove: { [f: string]: true } = Object.assign({}, ...Array.from(filesToRemove, (f: string) => ({ [f]: true })));
    const keptSyms = applyTo((xs: ScalaSymbol[]) => filesToRemove.length === 0 ? xs :
      xs.filter((s: ScalaSymbol) => !!!shouldRemove[s.file.uri]))(R.flatten(Object.values(this.cache)));
    this.cache = R.groupBy<ScalaSymbol>(prop("name"))(newSyms.concat(keptSyms)
      .sort(ordAll(Symbols.symToUri, path("location", "character"), path("location", "line"))));
    this.fuzzySearch = Symbols.initFuzzySearch(this.cache);
    return this.cache;
  }

  getTerm = (tdp: TextDocumentPositionParams): PromiseLike<Term> =>
    this.files.getFileContents(tdp.textDocument.uri).then(pipe(R.split("\n"), prop(tdp.position.line), buildTerm(tdp.position.character)))

  symbolsForPos = (tdp: TextDocumentPositionParams): PromiseLike<ScalaSymbol[]> =>
    this.getTerm(tdp).then((term: Term) => R.reject((sym: ScalaSymbol) =>
      sym.file.uri === tdp.textDocument.uri && sym.location.line === tdp.position.line &&
        sym.location.character >= term.range.start && sym.location.character <= term.range.end)(this.cache[term.term] || []));
}
