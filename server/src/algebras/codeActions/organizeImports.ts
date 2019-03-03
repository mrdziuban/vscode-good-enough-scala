import { flatten } from "fp-ts/lib/Array";
import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { CodeAction, CodeActionKind, CodeActionParams, TextEdit } from "vscode-languageserver";
import { Do } from "../../util";
import { Analytics } from "../analytics";
import { Files } from "../files";
import { baseCodeAction } from "./baseCodeAction";

interface ImportGroup { startLine: number; imports: string[]; }

export type NEL<A> = [A, ...A[]];

export const organizeImports = <M extends URIS>(M: Monad1<M>, A: Analytics<M>, F: Files<M>) =>
  baseCodeAction(M, A)(CodeActionKind.SourceOrganizeImports)((params: CodeActionParams): Type<M, CodeAction> => Do(M)(function*() {
    const contents: string = yield F.getFileContents(params.textDocument.uri);
    const importGroups: NEL<ImportGroup> =
      contents.split("\n").reduce((acc: NEL<ImportGroup>, line: string, idx: number) => {
        const isImport = /^import /.test(line.trim());
        if (isImport) {
          acc[0] = { startLine: acc[0].imports.length > 0 ? acc[0].startLine : idx, imports: acc[0].imports.concat([line]) };
        } else if (acc[0].imports.length > 0) {
          acc.unshift({ startLine: idx, imports: [] });
        }
        return acc;
      }, [{ startLine: 0, imports: [] }]);

    const edits: TextEdit[] = flatten(importGroups.map((importGroup: ImportGroup) =>
      importGroup.imports.sort().map((line: string, idx: number) => ({
        newText: line,
        range: {
          start: { line: importGroup.startLine + idx, character: 0 },
          end: { line: importGroup.startLine + idx, character: Number.MAX_VALUE }
        }
      }))));

    return {
      title: "Organize Imports",
      edit: { changes: { [params.textDocument.uri]: edits } }
    };
  }));
