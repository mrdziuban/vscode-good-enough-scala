import { CodeAction, CodeActionKind, CodeActionParams, createConnection, DidChangeConfigurationNotification, DidChangeTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType, FileEvent, Hover, InitializeParams, Location, MarkupKind, ProposedFeatures, SymbolInformation, TextDocumentContentChangeEvent, TextDocumentPositionParams, TextDocuments, TextDocumentSyncKind, WorkspaceSymbolParams } from "vscode-languageserver";
import { Analytics } from "./analytics";
import { CodeActions } from "./codeActions";
import { CodeActionDeps } from "./codeActions/util";
import { FileIndex as FileIndexStatic } from "./fileIndex";
import { FileCache, Files as FilesStatic } from "./files";
import Settings from "./settings";
import { ScalaSymbol, Symbols as SymbolsStatic } from "./symbols";
import { applyTo, exhaustive, path, pipe, setPath, toNel } from "./util";
import R = require("rambda");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments();
documents.listen(connection);

// tslint:disable variable-name
const Files = FilesStatic.init(connection);
const Symbols = SymbolsStatic.init(Files);
const FileIndex = FileIndexStatic.init(connection, Files, Symbols);
// tslint:enable variable-name

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

connection.onInitialized((() => {
  if (Settings.hasWorkspaceConfig()) { connection.client.register(DidChangeConfigurationNotification.type); }
  Settings.update(connection)();
  connection.sendRequest<string>("goodEnoughScalaMachineId").then(Analytics.init);
  FileIndex.indexAll();
}));

connection.onDefinition((tdp: TextDocumentPositionParams): PromiseLike<Location[]> =>
  Analytics.timedAsync("lookup", "definition")(() => Symbols.symbolsForPos(tdp).then((syms: ScalaSymbol[]) =>
    // The character position for a definition lookup needs to be decremented by 1 for some reason
    syms.map(pipe(SymbolsStatic.symToLoc, (l: Location) => setPath("range", "start", "character")(path("range", "start", "character")(l) - 1)(l))))));

connection.onHover((tdp: TextDocumentPositionParams): PromiseLike<Hover> | undefined =>
  R.ifElse(
    R.identity,
    () => Analytics.timedAsync("lookup", "hover")(() => Symbols.symbolsForPos(tdp).then((syms: ScalaSymbol[]) => ({
      contents: {
        kind: MarkupKind.Markdown,
        value: syms
          .map((sym: ScalaSymbol) => applyTo((line: string) => `[${sym.file.relativePath}:${line}](${SymbolsStatic.symToUri(sym)}#L${line})  `)(
            `${sym.location.line + 1},${sym.location.character}`))
          .join("\n")
      }
    }))),
    () => undefined)(Settings.get().hoverEnabled));

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] =>
  Analytics.timed("lookup", "workspaceSymbol")(() => Symbols.search(params.query).map((sym: ScalaSymbol) => ({
    name: sym.rawName,
    kind: sym.kind,
    location: SymbolsStatic.symToLoc(sym)
  }))));

connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
  Files.addJustChanged(params.textDocument.uri);
  params.contentChanges.reduce(
    (acc: PromiseLike<FileCache>, event: TextDocumentContentChangeEvent) =>
      acc.then((fs: FileCache) => Files.getRelPath(params.textDocument.uri).then((relativePath: string) =>
        Object.assign({}, fs, { [params.textDocument.uri]: { uri: params.textDocument.uri, relativePath, contents: event.text } }))),
    Promise.resolve({})).then(FileIndex.debounced("indexChanged"));
});

connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
  const [toIndex, toDelete] = params.changes.reduce(([i, d]: [string[], string[]], event: FileEvent): [string[], string[]] => {
    switch (event.type) {
      case FileChangeType.Changed: return Files.isJustChanged(event.uri) ? [i, d] : [i.concat([event.uri]), d];
      case FileChangeType.Created: return [i.concat([event.uri]), d];
      case FileChangeType.Deleted: return [i, d.concat([event.uri])];
    }
    return exhaustive(event.type);
  }, [[], []]);

  if (toIndex.length === 0 && toDelete.length === 0) { return; }

  const delFiles = toDelete.reduce((acc: { [uri: string]: "" }, u: string) => Object.assign({}, acc, { [u]: "" }), {});
  if (toIndex.length === 0) { FileIndex.debounced("indexChangedWatched")(delFiles); }
  Files.getFiles(toIndex).then((files: FileCache) => FileIndex.debounced("indexChangedWatched")(Object.assign({}, files, delFiles)));
});

connection.onCodeAction((params: CodeActionParams) => {
  const deps = { files: Files, symbols: Symbols };
  const nel = params.context.only ? toNel(params.context.only) : undefined;
  return Promise.all((nel ? CodeActions.filtered(nel) : CodeActions.all)
    .map(([_, f]: [any, (params: CodeActionParams, deps: CodeActionDeps) => PromiseLike<CodeAction>]) => f(params, deps)));
});

connection.listen();
