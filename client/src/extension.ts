import * as path from "path";
import { ExtensionContext, Uri } from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient";
import * as url from "url";

let client: LanguageClient;

export const active = (ctx: ExtensionContext) => {
  const serverModule = ctx.asAbsolutePath(path.join("server", "out", "server.js"));
  const baseOpts = { module: serverModule, transport: TransportKind.ipc };
  client = new LanguageClient(
    "goodEnoughScalaLSP",
    '"Good Enough" Scala Language Server',
    { run: baseOpts, debug: Object.assign(baseOpts, { options: { execArgv: ["--nolazy", "--inspect=6009"] } }) },
    {
      documentSelector: ["scala"],
      uriConverters: {
        // On Windows VS Code encodes the colon in paths, this fixes it
        // https://github.com/Microsoft/vscode-languageserver-node/issues/105
        code2Protocol: (uri: Uri) => url.format(url.parse(uri.toString(true))),
        protocol2Code: Uri.parse
      }
    });
  // Starting the client also launches the server
  client.start();
};

export const deactivate = () => !!client ? client.stop() : Promise.resolve(undefined);
