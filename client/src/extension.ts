import * as path from "path";
import { ExtensionContext } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
  const baseOpts = { module: serverModule, transport: TransportKind.ipc };
  client = new LanguageClient(
    "goodEnoughScalaLSP",
    '"Good Enough" Scala LSP',
    { run: baseOpts, debug: Object.assign(baseOpts, { options: { execArgv: ["--nolazy", "--inspect=6009"] } }) },
    {});
  // Starting the client also launches the server
  client.start();
}

export function deactivate(): Thenable<void> {
  return !!client ? client.stop() : Promise.resolve(undefined);
}
