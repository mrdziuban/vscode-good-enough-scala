import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { CodeAction, CodeActionKind, CodeActionParams } from "vscode-languageserver";
import { Analytics, timed } from "../analytics";

export const baseCodeAction = <M extends URIS>(M: Monad1<M>, A: Analytics<M>) => (kind: CodeActionKind) =>
  (f: (p: CodeActionParams) => Type<M, CodeAction>): [CodeActionKind, (p: CodeActionParams) => Type<M, CodeAction>] =>
    [kind, (params: CodeActionParams) => timed(M, A)("action", `codeAction.${kind}`)(
      () => M.map(f(params), (ca: CodeAction) => Object.assign({}, ca, { kind })))];
