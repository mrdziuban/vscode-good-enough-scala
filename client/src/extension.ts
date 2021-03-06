import * as path from "path";
import * as url from "url";
import { env, ExtensionContext, TextDocument, Uri, workspace } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient";

let client: LanguageClient;

// On Windows VS Code encodes the colon in paths, this fixes it
// https://github.com/Microsoft/vscode-languageserver-node/issues/105
const code2Protocol = (uri: Uri) => url.format(url.parse(uri.toString(true)));
const protocol2Code = Uri.parse;

const glob = "**/*.{routes,sbt,sc,scala,scala.html}";

interface File { uri: string; relativePath: string; contents: string; }
interface Files { [uri: string]: File; }

const relPath = (uri: Uri | string) => workspace.asRelativePath(uri);

const readFile = (uri: Uri): PromiseLike<File> =>
  workspace.openTextDocument(uri).then((td: TextDocument) => td.getText()).then((contents: string) =>
    ({ uri: code2Protocol(uri), relativePath: relPath(uri), contents }));

const readFiles = (uris: Uri[]): PromiseLike<Files> =>
  Promise.all(uris.map((uri: Uri) => readFile(uri))).then((files: File[]) =>
    Object.assign({}, ...Array.from(files, (f: File) => ({ [f.uri]: f }))));

export const activate = (ctx: ExtensionContext) => {
  const serverModule = ctx.asAbsolutePath(path.join("server", "out", "server.js"));
  const baseOpts = { module: serverModule, transport: TransportKind.ipc };
  client = new LanguageClient(
    "goodEnoughScalaLSP",
    '"Good Enough" Scala Language Server',
    { run: baseOpts, debug: Object.assign(baseOpts, { options: { execArgv: ["--nolazy", "--inspect=6009"] } }) },
    {
      documentSelector: ["routes", "scala", "twirl"],
      synchronize: { fileEvents: workspace.createFileSystemWatcher(glob) },
      uriConverters: { code2Protocol, protocol2Code }
    });

  client.onReady().then(() => {
    client.onRequest("goodEnoughScalaGetAllFiles", () => workspace.findFiles(glob).then(readFiles));
    client.onRequest("goodEnoughScalaGetFiles", ({ uris }: { uris: string[]; }) => readFiles(uris.map(protocol2Code)));
    client.onRequest("goodEnoughScalaGetRelPath", relPath);
    client.onRequest("goodEnoughScalaMachineId", () => env.machineId);
  });

  // Starting the client also launches the server
  client.start();
};

export const deactivate = () => !!client ? client.stop() : Promise.resolve(undefined);
