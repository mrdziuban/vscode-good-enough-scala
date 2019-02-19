import { CodeAction, CodeActionKind, CodeActionParams, TextEdit } from "vscode-languageserver";
import { NEL } from "../util";
import { baseCodeAction, CodeActionDeps } from "./util";
import R = require("rambda");

interface ImportGroup { startLine: number; imports: string[]; }

export const organizeImports = baseCodeAction(CodeActionKind.SourceOrganizeImports)((params: CodeActionParams, deps: CodeActionDeps): PromiseLike<CodeAction> =>
  deps.files.getFileContents(params.textDocument.uri).then((contents: string) => {
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

    const edits: TextEdit[] = R.flatten(importGroups.map((importGroup: ImportGroup) =>
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
