import { array } from "fp-ts/lib/Array";
import { identity } from "fp-ts/lib/function";
import { fromArray } from "fp-ts/lib/NonEmptyArray";
import { none, some } from "fp-ts/lib/Option";
import { CodeAction, CodeActionKind, CodeActionParams, createConnection, DidChangeConfigurationNotification, DidChangeConfigurationParams, DidChangeTextDocumentParams, DidChangeWatchedFilesParams, FileChangeType, FileEvent, Hover, InitializeParams, Location, MarkupKind, ProposedFeatures, SymbolInformation, TextDocumentContentChangeEvent, TextDocumentPositionParams, TextDocuments, TextDocumentSyncKind, WorkspaceSymbolParams } from "vscode-languageserver";
import { Algebras } from "./algebras";
import { filterCodeActions } from "./algebras/codeActions";
import { FileCache } from "./algebras/files";
import { ScalaSymbol, symToLoc, symToUri } from "./algebras/symbols";
import { fromPromiseL, getAlgebras, M, MHK, RTS } from "./effect";
import { applyTo, Do, exhaustive } from "./util";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments();
documents.listen(connection);

let hasWorkspaceConfig = false;

connection.onInitialize((params: InitializeParams) => {
  hasWorkspaceConfig = !!params.capabilities.workspace && !!params.capabilities.workspace.configuration;
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

connection.onInitialized(() => {
  const server = () => Do(M)(function*() {
    const algebras: Algebras<MHK> = yield getAlgebras(connection);
    const { codeActions, files, settings, store, symbols } = algebras;

    yield settings.updateHasWorkspaceConfig(hasWorkspaceConfig);

    yield hasWorkspaceConfig ? fromPromiseL(() => connection.client.register(DidChangeConfigurationNotification.type)) : M.of(undefined);
    yield settings.update();
    yield store.indexAllFiles();

    connection.onDidChangeConfiguration((params: DidChangeConfigurationParams) =>
      RTS.run(algebras)("action", "changedConfig")(() => settings.update(params)));

    connection.onDefinition((tdp: TextDocumentPositionParams): PromiseLike<Location[]> =>
      RTS.run(algebras)("lookup", "definition")(() => symbols.symbolsForPos(files)(tdp).map((syms: ScalaSymbol[]) => syms.map(symToLoc))));

    connection.onHover((tdp: TextDocumentPositionParams): PromiseLike<Hover | undefined> => RTS.run(algebras)("lookup", "hover")(() => Do(M)(function*() {
      const hoverEnabled: boolean = yield settings.get("hoverEnabled");
      return yield some(hoverEnabled).filter(identity).fold<M<Hover | undefined>>(M.of(undefined), () => symbols.symbolsForPos(files)(tdp).map((syms: ScalaSymbol[]) => ({
        contents: {
          kind: MarkupKind.Markdown,
          value: syms.map((sym: ScalaSymbol) => applyTo((line: string) =>
            `[${sym.file.relativePath}:${line}](${symToUri(sym)}#L${line})  `)(`${sym.location.line + 1},${sym.location.character + 1}`)).join("\n")
        }
      })));
    })));

    connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): PromiseLike<SymbolInformation[]> =>
      RTS.run(algebras)("lookup", "workspaceSymbol")(() =>
        symbols.search(params.query).map((syms: ScalaSymbol[]) => syms.map((sym: ScalaSymbol) => ({
          name: sym.rawName,
          kind: sym.kind,
          location: symToLoc(sym)
        })))));

    let debouncedFiles: FileCache = {};
    let debounceTick: NodeJS.Timer | undefined;

    const debouncedIndex = (action: string) => (toIndex: FileCache): void => {
      if (debounceTick) { clearTimeout(debounceTick); }
      debouncedFiles = Object.assign({}, debouncedFiles, toIndex);
      debounceTick = setTimeout(() => RTS.run(algebras)("action", action)(() =>
        store.indexFiles(debouncedFiles).map(() => { debouncedFiles = {}; })), 150);
    };

    connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => RTS.run(algebras)("action", "changedTextDocument")(() => Do(M)(function*() {
      yield files.addJustChanged(params.textDocument.uri);
      const toIndex: FileCache = yield params.contentChanges.reduce(
        (acc: M<FileCache>, event: TextDocumentContentChangeEvent) =>
          acc.chain((fc: FileCache) => files.getRelPath(params.textDocument.uri).map((relativePath: string) =>
            Object.assign({}, fc, { [params.textDocument.uri]: { uri: params.textDocument.uri, relativePath, contents: event.text } }))),
          M.of({}));
      debouncedIndex("indexChanged")(toIndex);
    })));

    connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => RTS.run(algebras)("action", "changedWatchedFiles")(() => Do(M)(function* () {
      const [toIndex, toDelete] = yield params.changes.reduce((acc: M<[string[], string[]]>, event: FileEvent) =>
        acc.chain(([i, d]: [string[], string[]]) => {
          switch (event.type) {
            case FileChangeType.Changed: return files.isJustChanged(event.uri).map((jc: boolean): [string[], string[]] => jc ? [i, d] : [i.concat([event.uri]), d]);
            case FileChangeType.Created: return M.of<[string[], string[]]>([i.concat([event.uri]), d]);
            case FileChangeType.Deleted: return M.of<[string[], string[]]>([i, d.concat([event.uri])]);
          }
        return exhaustive(event.type);
      }), M.of<[string[], string[]]>([[], []]));

      if (toIndex.length === 0 && toDelete.length === 0) { return; }
      const delFiles = toDelete.reduce((acc: { [uri: string]: "" }, u: string) => Object.assign({}, acc, { [u]: "" }), {});
      debouncedIndex("indexChangedWatched")(toIndex.length === 0
        ? delFiles
        : files.getFiles(some(toIndex)).map((fc: FileCache) => Object.assign({}, fc, delFiles)));
    })));

    connection.onCodeAction((params: CodeActionParams): PromiseLike<CodeAction[]> => RTS.run(algebras)("action", "codeAction")(() => Do(M)(function* () {
      const nel = params.context.only ? fromArray(params.context.only) : none;
      const fs = yield nel.foldL(() => codeActions.all, filterCodeActions(M, codeActions));
      return yield array.traverse(M)(fs, ([_, f]: [any, (p: CodeActionParams) => M<CodeAction>]) => f(params));
    })));
  });

  RTS.runUntimed(server());
});

connection.listen();
