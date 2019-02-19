import * as path from "path";
import { ExtensionContext } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
  client = new LanguageClient(
    "goodEnoughScalaLSP",
    '"Good Enough" Scala LSP',
    {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } }
    },
    { documentSelector: [{ scheme: "file", language: "scala" }] });
  // Starting the client also launches the server
  client.start();
}

export function deactivate(): Thenable<void> {
  return !!client ? client.stop() : Promise.resolve(undefined);
}
