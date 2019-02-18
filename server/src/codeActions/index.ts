import { CodeAction, CodeActionKind, CodeActionParams } from "vscode-languageserver";
import { NEL } from "../util";
import { organizeImports } from "./organizeImports";
import { CodeActionDeps } from "./util";

type CATuple = [CodeActionKind, (params: CodeActionParams, deps: CodeActionDeps) => PromiseLike<CodeAction>];

export class CodeActions {
  static readonly all: CATuple[] = [
    organizeImports
  ];

  static filtered = (only: NEL<CodeActionKind>): CATuple[] =>
    CodeActions.all.filter(([kind, _]: [CodeActionKind, any]) => only.includes(kind))
}
