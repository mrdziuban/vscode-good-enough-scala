import * as path from "path";
import { createConnection, DidChangeConfigurationNotification, DidChangeTextDocumentParams, DidChangeWatchedFilesParams, DidSaveTextDocumentParams, FileChangeType, FileEvent, Hover, InitializeParams, Location, MarkupKind, ProposedFeatures, SymbolInformation, SymbolKind, TextDocumentContentChangeEvent, TextDocumentPositionParams, TextDocuments, TextDocumentSyncKind, WorkspaceFolder, WorkspaceSymbolParams } from "vscode-languageserver";
import Analytics from "./analytics";
import Settings from "./settings";
import { applyTo, exhaustive, now, pipe, prop, withOpt } from "./util";
import fileUriToPath = require("file-uri-to-path");
import FuzzySearch = require("fuzzy-search");
import R = require("rambda");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments();
documents.listen(connection);

connection.onInitialize((params: InitializeParams) => {
  Settings.updateHasWorkspaceConfig(!!params.capabilities.workspace && !!params.capabilities.workspace.configuration);
  return {
    capabilities: {
      definitionProvider: true,
      hoverProvider: true,
      workspaceSymbolProvider: true,
      textDocumentSync: TextDocumentSyncKind.Full
    }
  };
});

connection.onDidChangeConfiguration(Settings.update(connection));

const symPrefix = "__SCALA_SYMBOL__";
const symName = (name: string) => `${symPrefix}${name}`;

const regexQuote = R.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface ScalaFile {
  uri: string;
  path: string;
}

interface ScalaSymbol {
  name: string;
  _name: string;
  kind: SymbolKind;
  file: ScalaFile;
  location: { line: number; character: number; };
}

const symToUri = (sym: ScalaSymbol) => sym.file.uri;
const symToLoc = (sym: ScalaSymbol) => Location.create(symToUri(sym), { start: sym.location, end: sym.location });

interface Symbols { [sym: string]: ScalaSymbol[]; }
let symbols: Symbols = {};
let fuzzySearch: FuzzySearch<ScalaSymbol> | undefined;

interface FileContents { [uri: string]: string; }
let fileContents: FileContents = {};

type SymbolExtractor = (f: ScalaFile, c: string) => ScalaSymbol[];

const extractMatches = (rx: RegExp, symbolType: string, kind: SymbolKind, file: ScalaFile) => (line: string, lineNum: number): ScalaSymbol[] => {
  const offset = symbolType.length + 2;
  const retVal = [];
  let matches = rx.exec(line);
  while (!!matches) {
    retVal.push({
      name: symName(matches[1]),
      _name: matches[1],
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

const defaultExtractor = (symType: string, kind: SymbolKind) => (file: ScalaFile, contents: string): ScalaSymbol[] => {
  const rx = new RegExp(`${symType} (${alphaRx.source}${termRx.source}+)`, "g");
  return R.flatten<ScalaSymbol>(contents.split("\n").map(extractMatches(rx, symType, kind, file)));
};

const symbolExtractors: SymbolExtractor[] = [
  defaultExtractor("class", SymbolKind.Class),
  defaultExtractor("trait", SymbolKind.Interface),
  defaultExtractor("object", SymbolKind.Class),
  defaultExtractor("val", SymbolKind.Variable),
  defaultExtractor("def", SymbolKind.Function),
  defaultExtractor("type", SymbolKind.TypeParameter)
];

const getFilePath = (uri: string): PromiseLike<string> => {
  const absPath = fileUriToPath(uri);
  return connection.workspace.getWorkspaceFolders()
    .then(R.ifElse(R.isNil, () => [], R.identity))
    .then((folders: WorkspaceFolder[]) => {
      const dir = folders.map(pipe(prop("uri"), fileUriToPath)).find((f: string) => (new RegExp(`^${regexQuote(f)}`).test(absPath)));
      return dir ? absPath.replace(new RegExp(`^${regexQuote(dir)}(${regexQuote(path.sep)}|\/)?`), "") : absPath;
    });
};

const indexFiles = (files: FileContents): PromiseLike<ScalaSymbol[]> => {
  const start = now();
  const shouldRemove: { [f: string]: true } = Object.keys(files).reduce((acc: { [f: string]: true }, f: string) => Object.assign(acc, { [f]: true }), {});
  const symsPromise = Promise.all(Object.entries(files).map(([uri, contents]: [string, string]) => getFilePath(uri)
    .then((p: string) => R.flatten(symbolExtractors.map((ex: SymbolExtractor) => ex({ uri, path: p }, contents)))))).then(R.flatten);
  return symsPromise.then((syms: ScalaSymbol[]) => {
    fileContents = Object.assign({}, fileContents, files);
    symbols = syms.reduce(
      (acc: Symbols, sym: ScalaSymbol) => Object.assign({}, acc, { [sym.name]: (acc[sym.name] || []).concat([sym]) }),
      Object.entries(symbols).reduce((acc: Symbols, [name, xs]: [string, ScalaSymbol[]]) =>
        Object.assign({}, acc, { [name]: xs.filter((s: ScalaSymbol) => !!!shouldRemove[s.file.uri]) }), {}));
    fuzzySearch = new FuzzySearch(R.flatten<ScalaSymbol>(Object.values(symbols)), ["_name"], { caseSensitive: false, sort: true });
    connection.console.log(`Indexed ${Object.keys(symbols).length} scala symbols in ${now() - start}ms`);
    return syms;
  });
};

const indexAllFiles = () => Analytics.timedAsync("action", "indexAll")(() =>
  connection.sendRequest<FileContents>("goodEnoughScalaGetAllFiles").then(indexFiles));

const getFiles = (uris: string[]): PromiseLike<FileContents> => connection.sendRequest<FileContents>("goodEnoughScalaGetFiles", { uris });

const indexChangedFiles = (toIndex: string[], toDelete: string[]) => Analytics.timedAsync("action", "indexChanged")(() => {
  const delFiles = toDelete.reduce((acc: { [uri: string]: "" }, u: string) => Object.assign({}, acc, { [u]: "" }), {});
  if (toIndex.length === 0) { return indexFiles(delFiles); }
  return getFiles(toIndex).then((files: FileContents) => indexFiles(Object.assign({}, files, delFiles)));
});

connection.onInitialized((() => {
  if (Settings.hasWorkspaceConfig()) { connection.client.register(DidChangeConfigurationNotification.type); }
  Settings.update(connection)();
  connection.sendRequest<string>("goodEnoughScalaMachineId").then(Analytics.init);
  indexAllFiles();
}));

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

const getTerm = (tdp: TextDocumentPositionParams): PromiseLike<Term> =>
  (fileContents[tdp.textDocument.uri] ? Promise.resolve(fileContents[tdp.textDocument.uri]) : getFiles([tdp.textDocument.uri])
    .then(prop(tdp.textDocument.uri))).then(pipe(R.split("\n"), prop(tdp.position.line), buildTerm(tdp.position.character)));

const symbolsForPos = (tdp: TextDocumentPositionParams): PromiseLike<ScalaSymbol[]> =>
  getTerm(tdp).then((term: Term) => R.reject((sym: ScalaSymbol) =>
    sym.file.uri === tdp.textDocument.uri && sym.location.line === tdp.position.line &&
      sym.location.character >= term.range.start && sym.location.character <= term.range.end)(symbols[term.term] || []));

connection.onDefinition((tdp: TextDocumentPositionParams): PromiseLike<Location[]> =>
  Analytics.timedAsync("lookup", "definition")(() => symbolsForPos(tdp).then((syms: ScalaSymbol[]) => syms.map(symToLoc))));

const comp = (i1: string | number, i2: string | number) => i1 < i2 ? -1 : (i1 === i2 ? 0 : 1);

connection.onHover((tdp: TextDocumentPositionParams): PromiseLike<Hover> | undefined =>
  R.ifElse(
    R.identity,
    () => Analytics.timedAsync("lookup", "hover")(() => symbolsForPos(tdp).then((syms: ScalaSymbol[]) => ({
      contents: {
        kind: MarkupKind.Markdown,
        value: syms
          .sort((s1: ScalaSymbol, s2: ScalaSymbol) => applyTo((c1: -1 | 0 | 1) =>
            c1 === 0 ? applyTo((c2: -1 | 0 | 1) => c2 === 0 ? comp(s1.location.character, s2.location.character) : c2)(
              comp(s1.location.line, s2.location.line)) : c1)(comp(symToUri(s1), symToUri(s2))))
          .map((sym: ScalaSymbol) => applyTo((line: string) => `[${sym.file.path}:${line}](${symToUri(sym)}#L${line})  `)(
            `${sym.location.line + 1},${sym.location.character}`))
          .join("\n")
      }
    }))),
    () => undefined)(Settings.get().hoverEnabled));

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] | undefined =>
  Analytics.timed("lookup", "workspaceSymbol")(() =>
    withOpt((s: FuzzySearch<ScalaSymbol>) => s.search(params.query.toLowerCase()).map((sym: ScalaSymbol) => ({
      name: sym.name.replace(new RegExp(`^${symPrefix}`), ""),
      kind: sym.kind,
      location: symToLoc(sym)
    })))(fuzzySearch)));

connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) =>
  (params.text ? Promise.resolve(params.text) : getFiles([params.textDocument.uri]).then(indexFiles)));

connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) =>
  indexFiles(params.contentChanges.reduce((acc: FileContents, event: TextDocumentContentChangeEvent) =>
    Object.assign({}, acc, { [params.textDocument.uri]: event.text }), {})));

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const [toIndex, toDelete] = params.changes.reduce(([i, d]: [string[], string[]], event: FileEvent): [string[], string[]] => {
    switch (event.type) {
      case FileChangeType.Changed:
      case FileChangeType.Created: return [i.concat([event.uri]), d];
      case FileChangeType.Deleted: return [i, d.concat([event.uri])];
    }
    return exhaustive(event.type);
  }, [[], []]);
  indexChangedFiles(toIndex, toDelete);
});

connection.listen();
