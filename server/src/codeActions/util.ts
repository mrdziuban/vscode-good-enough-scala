import { CodeAction, CodeActionKind, CodeActionParams } from "vscode-languageserver";
import { Analytics } from "../analytics";
import { Files } from "../files";
import { Symbols } from "../symbols";

export interface CodeActionDeps {
  files: Files;
  symbols: Symbols;
}

export const baseCodeAction = (kind: CodeActionKind) =>
  (f: (p: CodeActionParams, d: CodeActionDeps) => PromiseLike<CodeAction>): [CodeActionKind, (params: CodeActionParams, deps: CodeActionDeps) => PromiseLike<CodeAction>] =>
    [kind, (params: CodeActionParams, deps: CodeActionDeps) => Analytics.timedAsync("action", `codeAction.${kind}`)(
      () => f(params, deps).then((ca: CodeAction) => Object.assign({}, ca, { kind })))];
