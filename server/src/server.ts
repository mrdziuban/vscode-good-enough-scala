import {
  createConnection,
  DidChangeConfigurationNotification,
  Hover,
  InitializeParams,
  Location,
  MarkupKind,
  ProposedFeatures,
  SymbolInformation,
  SymbolKind,
  TextDocumentPositionParams,
  TextDocuments,
  WorkspaceFolder,
  WorkspaceSymbolParams
} from "vscode-languageserver";
import Analytics from "./analytics";
import { spawnSync } from "child_process";
import * as commandExists from "command-exists";
import fileUriToPath = require("file-uri-to-path");
import * as fs from "fs";
import FuzzySearch = require("fuzzy-search");
import * as path from "path";
import R = require("rambda");
import Settings from "./settings";
import {URL} from "url";
import {now, withOpt} from "./util";

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
      textDocumentSync: documents.syncKind
    }
  };
});

connection.onDidChangeConfiguration(Settings.update(connection));

const symPrefix = "__SCALA_SYMBOL__";
const symName = (name: string) => `${symPrefix}${name}`;

const regexQuote = R.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface ScalaFile {
  absolutePath: string;
  relativePath: string;
}

const loggedGetFiles = (getMethod: string, dir: string, getter: (dir: string) => string[]) => {
  connection.console.log(`Getting scala files with ${getMethod}`);
  const res = getter(dir);
  connection.console.log(`Found ${res.length} scala files to index`);
  return res;
};

const getFilesCommand = (cmd: string, args: string[]): string[] =>
  spawnSync(cmd, args).stdout.toString().trim().split("\n").filter((f: string) => f !== "");

const gitScalaFiles = (dir: string) =>
  getFilesCommand("git", ["--git-dir", path.join(dir, ".git"), "ls-files", "*.scala", "*.sc"]).map((f: string) => path.join(dir, f));

const findCmdScalaFiles = (dir: string): string[] =>
  getFilesCommand("find", [dir, "-type", "f", "(", "-iname", "*.scala", "-o", "-iname", "*.sc", ")"]);

const fsScalaFiles = (dir: string, files: string[] = []): string[] =>
  files.concat(R.flatten<string>(fs.readdirSync(dir).map((file: string) => {
    const joined = path.resolve(path.join(dir, file));
    return fs.statSync(joined).isDirectory()
      ? fsScalaFiles(joined, files)
      : (/\.scala$/.test(joined) ? [joined] : []);
  })));

interface Getter { method: string; getter: (dir: string) => string[]; }
const getScalaFiles = (dir: string): string[] =>
  R.ifElse(
    R.isNil,
    () => [],
    ({ method, getter }: Getter) => loggedGetFiles(method, dir, getter))(R.find(R.pipe(R.isNil, R.not))([
      fs.existsSync(path.join(dir, ".git")) ? { method: "git", getter: gitScalaFiles } : undefined,
      commandExists.sync("find") ? { method: "`find`", getter: findCmdScalaFiles } : undefined,
      { method: "fs", getter: fsScalaFiles }
    ]));

interface ScalaSymbol {
  name: string;
  _name: string;
  kind: SymbolKind;
  file: ScalaFile;
  location: { line: number; character: number; };
}

const symToUri = (sym: ScalaSymbol) => (new URL(`file://${sym.file.absolutePath}`)).href;
const symToLoc = (sym: ScalaSymbol) => Location.create(symToUri(sym), { start: sym.location, end: sym.location });

interface Symbols { [sym: string]: ScalaSymbol[]; }
let symbols: Symbols = {};
let fuzzySearch: FuzzySearch<ScalaSymbol> | undefined;

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

const getScalaSymbols = (file: ScalaFile): ScalaSymbol[] => {
  const contents = fs.readFileSync(file.absolutePath).toString();
  return R.flatten<ScalaSymbol>(symbolExtractors.map((ex: SymbolExtractor) => ex(file, contents)));
};

const update = () => Analytics.timed<void>("action", "update")(() => {
  const start = now();
  connection.workspace.getWorkspaceFolders()
    .then((fldrs: WorkspaceFolder[] | null) =>
      R.flatten<ScalaFile>((fldrs || [])
        .filter((f: WorkspaceFolder) => /^file:\/\//i.test(f.uri))
        .map((f: WorkspaceFolder) => fileUriToPath(f.uri))
        .map((dir: string): ScalaFile[] =>
          getScalaFiles(dir).map((f: string) => ({
            absolutePath: f,
            relativePath: f.replace(new RegExp(`^${regexQuote(dir)}(${regexQuote(path.sep)}|\/)?`), "")
          })))))
    .then((files: ScalaFile[]) =>
      Promise.all(files.map((file: ScalaFile) =>
        new Promise((resolve: (syms: ScalaSymbol[]) => void) => resolve(getScalaSymbols(file))))))
    // This should just be `ScalaSymbol[][]` but the compiler is complaining. See cast below.
    .then((syms: Promise<ScalaSymbol[][]>) => {
      symbols = R.flatten<ScalaSymbol>(<any>syms as ScalaSymbol[][]).reduce((acc: Symbols, sym: ScalaSymbol) => {
        acc[sym.name] = (acc[sym.name] || []).concat([sym]);
        return acc;
      }, {});
      fuzzySearch = new FuzzySearch(R.flatten<ScalaSymbol>(Object.values(symbols)), ["_name"], { caseSensitive: false, sort: true });
      connection.console.log(`Finished indexing ${Object.keys(symbols).length} scala symbols in ${now() - start}ms`);
    });
});

connection.onInitialized((() => {
  if (Settings.hasWorkspaceConfig()) { connection.client.register(DidChangeConfigurationNotification.type); }
  Settings.update(connection)();
  update();
  connection.sendRequest<string>("goodEnoughScalaMachineId").then(Analytics.init);
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

  return R.pipe(
    append(R.dec, R.concat),
    ([term, start]: [string, number]) => [start, append(R.inc, R.flip<string, string, string>(R.concat))(term)],
    ([start, [term, end]]: [number, [string, number]]) => ({ term: symName(term), range: { start, end } }))(line[charPos]);
};

const getTerm = (tdp: TextDocumentPositionParams): Term | undefined =>
  R.ifElse(R.isNil, () => undefined, R.pipe(
    fs.readFileSync,
    R.toString,
    R.split("\n"),
    R.path([tdp.position.line]),
    buildTerm(tdp.position.character)))(fileUriToPath(tdp.textDocument.uri));

const symbolsForPos = (tdp: TextDocumentPositionParams): ScalaSymbol[] | undefined =>
  withOpt((term: Term) => R.reject((sym: ScalaSymbol) =>
    sym.file.absolutePath === fileUriToPath(tdp.textDocument.uri) && sym.location.line === tdp.position.line &&
      sym.location.character >= term.range.start && sym.location.character <= term.range.end)(symbols[term.term] || []))(getTerm(tdp));

connection.onDefinition((tdp: TextDocumentPositionParams): Location[] | undefined =>
  Analytics.timed<Location[] | undefined>("lookup", "definition")(() =>
    withOpt((syms: ScalaSymbol[]) => syms.map(symToLoc))(symbolsForPos(tdp))));

connection.onHover((tdp: TextDocumentPositionParams): Hover | undefined =>
  R.ifElse(
    R.identity,
    () => Analytics.timed<Hover | undefined>("lookup", "hover")(() => withOpt((syms: ScalaSymbol[]) => ({
      contents: {
        kind: MarkupKind.Markdown,
        value: R.sortBy(R.path(["file", "absolutePath"]))(syms).map((sym: ScalaSymbol) => {
          const line = `${sym.location.line + 1},${sym.location.character}`;
          return `[${sym.file.relativePath}:${line}](${symToUri(sym)}#L${line})  `;
        }).join("\n")
      }
    }))(symbolsForPos(tdp))),
    () => undefined)(Settings.get().hoverEnabled));

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] | undefined =>
  Analytics.timed<SymbolInformation[] | undefined>("lookup", "workspaceSymbol")(() =>
    withOpt((s: FuzzySearch<ScalaSymbol>) => s.search(params.query.toLowerCase()).map((sym: ScalaSymbol) => ({
      name: sym.name.replace(new RegExp(`^${symPrefix}`), ""),
      kind: sym.kind,
      location: symToLoc(sym)
    })))(fuzzySearch)));

// TODO - can a single file be updated in the index on save?
connection.onDidSaveTextDocument(update);

connection.listen();
