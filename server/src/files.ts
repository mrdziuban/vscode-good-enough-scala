import { Connection } from "vscode-languageserver";
import { path } from "./util";

export interface ScalaFile {
  uri: string;
  relativePath: string;
}

export interface File { uri: string; relativePath: string; contents: string; }
export interface FileCache { [uri: string]: File; }

export class Files {
  private connection: Connection;
  private cache: FileCache = {};
  private justChanged: { [uri: string]: boolean } = {};

  static init = (connection: Connection): Files => new Files(connection);

  constructor(connection: Connection) {
    this.connection = connection;
  }

  updateCache = (contents: FileCache) => this.cache = Object.assign({}, this.cache, contents);

  getFiles = (uris: string[]): PromiseLike<FileCache> => this.connection.sendRequest<FileCache>("goodEnoughScalaGetFiles", { uris });

  getFileContents = (uri: string): PromiseLike<string> =>
    this.cache[uri] ? Promise.resolve(this.cache[uri].contents) : this.getFiles([uri]).then(path(uri, "contents"))

  getRelPath = (uri: string): PromiseLike<string> =>
    (this.cache[uri] ? Promise.resolve(this.cache[uri].relativePath) : this.connection.sendRequest("goodEnoughScalaGetRelPath", uri))

  addJustChanged = (uri: string) => {
    this.justChanged[uri] = true;
    setTimeout(() => this.justChanged[uri] = false, 500);
  }

  isJustChanged = (uri: string): boolean => !!this.justChanged[uri];
}
