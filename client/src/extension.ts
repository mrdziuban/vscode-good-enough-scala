import * as path from "path";
import { ExtensionContext, Uri } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient";
import * as url from "url";

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
  const baseOpts = { module: serverModule, transport: TransportKind.ipc };
  client = new LanguageClient(
    "goodEnoughScalaLSP",
    '"Good Enough" Scala LSP',
    { run: baseOpts, debug: Object.assign(baseOpts, { options: { execArgv: ["--nolazy", "--inspect=6009"] } }) },
    {
      documentSelector: ["scala"],
      uriConverters: {
        // VS Code by default %-encodes even the colon after the drive letter
        // NodeJS handles it much better
        code2Protocol: (uri: Uri) => url.format(url.parse(uri.toString(true))),
        protocol2Code: (str: string) => Uri.parse(str)
      }
    });
  // Starting the client also launches the server
  client.start();
}

export function deactivate(): Thenable<void> {
  return !!client ? client.stop() : Promise.resolve(undefined);
}
