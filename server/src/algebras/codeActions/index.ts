import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { NonEmptyArray } from "fp-ts/lib/NonEmptyArray";
import { CodeAction, CodeActionKind, CodeActionParams } from "vscode-languageserver";
import { Analytics } from "../analytics";
import { Files } from "../files";
import { organizeImports } from "./organizeImports";

type CATuple<M extends URIS> = [CodeActionKind, (params: CodeActionParams) => Type<M, CodeAction>];

export interface CodeActions<M extends URIS> {
  all: Type<M, CATuple<M>[]>;
}

export const defaultCodeActions = <M extends URIS>(M: Monad1<M>, A: Analytics<M>, F: Files<M>): CodeActions<M> => ({
  all: M.of([
    organizeImports(M, A, F)
  ])
});

export const filterCodeActions = <M extends URIS>(M: Monad1<M>, C: CodeActions<M>) => (only: NonEmptyArray<CodeActionKind>): Type<M, CATuple<M>[]> =>
  M.map(C.all, (cas: CATuple<M>[]) => cas.filter(([kind, _]: [CodeActionKind, any]) => only.some((k: CodeActionKind) => k === kind)));
