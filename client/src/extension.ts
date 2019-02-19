import * as path from "path";
import * as url from "url";
import { env, ExtensionContext, TextDocument, Uri, workspace } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient";

let client: LanguageClient;

// On Windows VS Code encodes the colon in paths, this fixes it
// https://github.com/Microsoft/vscode-languageserver-node/issues/105
const code2Protocol = (uri: Uri) => url.format(url.parse(uri.toString(true)));
const protocol2Code = Uri.parse;

const readFile = (uri: Uri): PromiseLike<{ [f: string]: string }> =>
  workspace.openTextDocument(uri).then((td: TextDocument) => td.getText()).then((content: string) => ({ [code2Protocol(uri)]: content }));

const readFiles = (uris: Uri[]): PromiseLike<{ [f: string]: string }> =>
  uris.reduce((acc: Promise<{ [f: string]: string }>, uri: Uri) => Promise.all([acc, readFile(uri)])
    .then((os: { [f: string]: string }[]) => Object.assign({}, ...os)), Promise.resolve({}));

export const activate = (ctx: ExtensionContext) => {
  const serverModule = ctx.asAbsolutePath(path.join("server", "out", "server.js"));
  const baseOpts = { module: serverModule, transport: TransportKind.ipc };
  client = new LanguageClient(
    "goodEnoughScalaLSP",
    '"Good Enough" Scala Language Server',
    { run: baseOpts, debug: Object.assign(baseOpts, { options: { execArgv: ["--nolazy", "--inspect=6009"] } }) },
    {
      documentSelector: ["scala"],
      synchronize: { fileEvents: workspace.createFileSystemWatcher("**/*.scala") },
      uriConverters: { code2Protocol, protocol2Code }
    });

  client.onReady().then(() => {
    client.onRequest("goodEnoughScalaGetAllFiles", () => workspace.findFiles("**/*.scala").then(readFiles));
    client.onRequest("goodEnoughScalaGetFiles", ({ uris }: { uris: string[]; }) => readFiles(uris.map(protocol2Code)));
    client.onRequest("goodEnoughScalaMachineId", () => env.machineId);
  });

  // Starting the client also launches the server
  client.start();
};

export const deactivate = () => !!client ? client.stop() : Promise.resolve(undefined);
