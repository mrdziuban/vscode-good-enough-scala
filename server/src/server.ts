import { CodeAction, CodeActionKind, CodeActionParams, createConnection, DidChangeConfigurationNotification, DidChangeTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType, FileEvent, Hover, InitializeParams, Location, MarkupKind, ProposedFeatures, SymbolInformation, SymbolKind, TextDocumentContentChangeEvent, TextDocumentPositionParams, TextDocuments, TextDocumentSyncKind, TextEdit, WorkspaceSymbolParams } from "vscode-languageserver";
import Analytics from "./analytics";
import Settings from "./settings";
import { applyTo, exhaustive, now, path, pipe, prop, withOpt } from "./util";
import FuzzySearch = require("fuzzy-search");
import R = require("rambda");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments();
documents.listen(connection);

connection.onInitialize((params: InitializeParams) => {
  Settings.updateHasWorkspaceConfig(!!params.capabilities.workspace && !!params.capabilities.workspace.configuration);
  return {
    capabilities: {
      codeActionProvider: { codeActionKinds: [CodeActionKind.SourceOrganizeImports] },
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

interface ScalaFile {
  uri: string;
  relativePath: string;
}

interface ScalaSymbol {
  name: string;
  rawName: string;
  kind: SymbolKind;
  file: ScalaFile;
  location: { line: number; character: number; };
}

const symToUri = (sym: ScalaSymbol) => sym.file.uri;
const symToLoc = (sym: ScalaSymbol) => Location.create(symToUri(sym), { start: sym.location, end: sym.location });

interface Symbols { [sym: string]: ScalaSymbol[]; }
let symbols: Symbols = {};
let fuzzySearch: FuzzySearch<ScalaSymbol> | undefined;

interface File { uri: string; relativePath: string; contents: string; }
interface FileContents { [uri: string]: File; }
let fileContents: FileContents = {};

const getFiles = (uris: string[]): PromiseLike<FileContents> => connection.sendRequest<FileContents>("goodEnoughScalaGetFiles", { uris });

const getFileContents = (uri: string): PromiseLike<string> =>
  fileContents[uri] ? Promise.resolve(fileContents[uri].contents) : getFiles([uri]).then(path(uri, "contents"));

const getRelPath = (uri: string): PromiseLike<string> =>
  (fileContents[uri] ? Promise.resolve(fileContents[uri].relativePath) : connection.sendRequest("goodEnoughScalaGetRelPath", uri));

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

const indexFiles = (files: FileContents): PromiseLike<ScalaSymbol[]> => new Promise((resolve: (s: ScalaSymbol[]) => void) => {
  const start = now();
  const shouldRemove: { [f: string]: true } = Object.keys(files).reduce((acc: { [f: string]: true }, f: string) => Object.assign({}, acc, { [f]: true }), {});
  const syms = R.flatten(Object.values(files).map((file: File) => {
    const scalaFile = { uri: file.uri, relativePath: file.relativePath };
    return R.flatten(symbolExtractors.map((ex: SymbolExtractor) => ex(scalaFile, file.contents)));
  }));
  fileContents = Object.assign({}, fileContents, files);
  symbols = syms.reduce(
    (acc: Symbols, sym: ScalaSymbol) => Object.assign({}, acc, { [sym.name]: (acc[sym.name] || []).concat([sym]) }),
    Object.entries(symbols).reduce((acc: Symbols, [name, xs]: [string, ScalaSymbol[]]) =>
    Object.assign({}, acc, { [name]: xs.filter((s: ScalaSymbol) => !!!shouldRemove[s.file.uri]) }), {}));
  fuzzySearch = new FuzzySearch(R.flatten<ScalaSymbol>(Object.values(symbols)), ["rawName"], { caseSensitive: false, sort: true });
  connection.console.log(`Indexed ${Object.keys(symbols).length} scala symbols in ${now() - start}ms`);
  resolve(syms);
});

let indexTick: NodeJS.Timer | undefined;
let filesToIndex: FileContents = {};

const debouncedIndexFiles = (action: string) => (files: FileContents) => {
  if (indexTick) { clearTimeout(indexTick); }
  filesToIndex = Object.assign({}, filesToIndex, files);
  indexTick = setTimeout(() => Analytics.timedAsync("action", action)(() => indexFiles(filesToIndex).then(() => filesToIndex = {})), 150);
};

const indexAllFiles = () => Analytics.timedAsync("action", "indexAll")(() =>
  connection.sendRequest<FileContents>("goodEnoughScalaGetAllFiles").then(indexFiles));

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
  getFileContents(tdp.textDocument.uri).then(pipe(R.split("\n"), prop(tdp.position.line), buildTerm(tdp.position.character)));

const symbolsForPos = (tdp: TextDocumentPositionParams): PromiseLike<ScalaSymbol[]> =>
  getTerm(tdp).then((term: Term) => R.reject((sym: ScalaSymbol) =>
    sym.file.uri === tdp.textDocument.uri && sym.location.line === tdp.position.line &&
      sym.location.character >= term.range.start && sym.location.character <= term.range.end)(symbols[term.term] || []));

connection.onDefinition((tdp: TextDocumentPositionParams): PromiseLike<Location[]> =>
  Analytics.timedAsync("lookup", "definition")(() => symbolsForPos(tdp).then((syms: ScalaSymbol[]) => syms.map(symToLoc))));

const comp = (i1: string | number, i2: string | number) => i1 < i2 ? -1 : (i1 === i2 ? 0 : 1);
const compAll = <A>(...[f, fs]: [(a: A) => string | number, ...((a: A) => string | number)[]]) => (a1: A, a2: A): -1 | 0 | 1 =>
  [f].concat(fs).reduce((acc: -1 | 0 | 1, fn: (a: A) => string | number) => acc === 0 ? comp(fn(a1), fn(a2)) : acc, comp(f(a1), f(a2)));

connection.onHover((tdp: TextDocumentPositionParams): PromiseLike<Hover> | undefined =>
  R.ifElse(
    R.identity,
    () => Analytics.timedAsync("lookup", "hover")(() => symbolsForPos(tdp).then((syms: ScalaSymbol[]) => ({
      contents: {
        kind: MarkupKind.Markdown,
        value: syms.sort(compAll(symToUri, path("location", "character"), path("location", "line")))
          .map((sym: ScalaSymbol) => applyTo((line: string) => `[${sym.file.relativePath}:${line}](${symToUri(sym)}#L${line})  `)(
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

const justChanged: { [uri: string]: boolean } = {};

const addJustChanged = (uri: string) => {
  justChanged[uri] = true;
  setTimeout(() => justChanged[uri] = false, 500);
};

connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
  addJustChanged(params.textDocument.uri);
  params.contentChanges.reduce(
    (acc: PromiseLike<FileContents>, event: TextDocumentContentChangeEvent) =>
      acc.then((fs: FileContents) => getRelPath(params.textDocument.uri).then((relativePath: string) =>
        Object.assign({}, fs, { [params.textDocument.uri]: { uri: params.textDocument.uri, relativePath, contents: event.text } }))),
    Promise.resolve({})).then(debouncedIndexFiles("indexChanged"));
});

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const [toIndex, toDelete] = params.changes.reduce(([i, d]: [string[], string[]], event: FileEvent): [string[], string[]] => {
    switch (event.type) {
      case FileChangeType.Changed: return justChanged[event.uri] ? [i, d] : [i.concat([event.uri]), d];
      case FileChangeType.Created: return [i.concat([event.uri]), d];
      case FileChangeType.Deleted: return [i, d.concat([event.uri])];
    }
    return exhaustive(event.type);
  }, [[], []]);

  if (toIndex.length === 0 && toDelete.length === 0) { return; }

  const delFiles = toDelete.reduce((acc: { [uri: string]: "" }, u: string) => Object.assign({}, acc, { [u]: "" }), {});
  if (toIndex.length === 0) { debouncedIndexFiles("indexChangedWatched")(delFiles); }
  getFiles(toIndex).then((files: FileContents) => debouncedIndexFiles("indexChangedWatched")(Object.assign({}, files, delFiles)));
});

const baseCodeAction = (kind: CodeActionKind) => (f: (params: CodeActionParams) => PromiseLike<CodeAction>): [CodeActionKind, (params: CodeActionParams) => PromiseLike<CodeAction>] =>
  [kind, (params: CodeActionParams) => Analytics.timedAsync("action", "organizeImports")(
    () => f(params).then((ca: CodeAction) => Object.assign({}, ca, { kind })))];

interface ImportGroup { startLine: number; imports: string[]; }

const organizeImports = baseCodeAction(CodeActionKind.SourceOrganizeImports)((params: CodeActionParams): PromiseLike<CodeAction> =>
  getFileContents(params.textDocument.uri).then((contents: string) => {
    const importGroups: [ImportGroup, ...ImportGroup[]] =
      contents.split("\n").reduce((acc: [ImportGroup, ...ImportGroup[]], line: string, idx: number) => {
        const isImport = /^import /.test(line.trim());
        if (isImport) {
          acc[0] = { startLine: acc[0].imports.length > 0 ? acc[0].startLine : idx, imports: acc[0].imports.concat([line]) };
        } else if (acc[0].imports.length > 0) {
          acc.unshift({ startLine: idx, imports: [] });
        }
        return acc;
      }, [{ startLine: 0, imports: [] }]);

    const edits: TextEdit[] = R.flatten(importGroups.map((importGroup: ImportGroup) =>
      importGroup.imports.sort().map((line: string, idx: number) => ({
        newText: line,
        range: {
          start: { line: importGroup.startLine + idx, character: 0 },
          end: { line: importGroup.startLine + idx, character: Number.MAX_VALUE }
        }
      }))));

    return {
      title: "Organize Imports",
      edit: { changes: { [params.textDocument.uri]: edits } }
    };
  }));

const codeActions: [CodeActionKind, (params: CodeActionParams) => PromiseLike<CodeAction>][] = [
  organizeImports
];

connection.onCodeAction((params: CodeActionParams) =>
  Promise.all((params.context.only && params.context.only.length > 0
    ? codeActions.filter(([kind, _]: [CodeActionKind, any]) => (params.context.only || []).includes(kind))
    : codeActions).map(([_, f]: [any, (params: CodeActionParams) => PromiseLike<CodeAction>]) => f(params))));

connection.listen();
