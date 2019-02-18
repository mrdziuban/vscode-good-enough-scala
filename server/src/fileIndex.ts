import { Connection } from "vscode-languageserver";
import { Analytics } from "./analytics";
import { FileCache, Files } from "./files";
import { ScalaSymbol, Symbols } from "./symbols";
import { now } from "./util";
import R = require("rambda");

export class FileIndex {
  private connection: Connection;
  private files: Files;
  private filesToIndex: FileCache = {};
  private symbols: Symbols;
  private indexTick: NodeJS.Timer | undefined;

  static init = (connection: Connection, files: Files, symbols: Symbols): FileIndex => new FileIndex(connection, files, symbols);

  constructor(connection: Connection, files: Files, symbols: Symbols) {
    this.connection = connection;
    this.files = files;
    this.symbols = symbols;
  }

  index = (files: FileCache): PromiseLike<ScalaSymbol[]> => new Promise((resolve: (s: ScalaSymbol[]) => void) => {
    const start = now();
    this.files.updateCache(files);
    const symbols = this.symbols.updateCache(Symbols.extract(files), Object.keys(files));
    this.connection.console.log(`Indexed ${Object.keys(symbols).length} scala symbols in ${now() - start}ms`);
    resolve(R.flatten(Object.values(symbols)));
  })

  indexAll = () => Analytics.timedAsync("action", "indexAll")(() =>
    this.connection.sendRequest<FileCache>("goodEnoughScalaGetAllFiles").then(this.index))

  debounced = (action: string) => (files: FileCache) => {
    if (this.indexTick) { clearTimeout(this.indexTick); }
    this.filesToIndex = Object.assign({}, this.filesToIndex, files);
    this.indexTick = setTimeout(() => Analytics.timedAsync("action", action)(() =>
      this.index(this.filesToIndex).then(() => this.filesToIndex = {})), 150);
  }
}
