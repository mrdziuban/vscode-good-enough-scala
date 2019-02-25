import * as fc from "fast-check";
import { identity } from "fp-ts/lib/Identity";
import { SymbolKind } from "vscode-languageserver";
import { FileCache } from "../../../src/algebras/files";
import { ScalaSymbol } from "../../../src/algebras/symbols";
import { Do } from "../../../src/util";
import { algebras, arbSpaces, arbStr, aToZ } from "../../util";

const mkFiles = (fs: [string, string][]): FileCache =>
  Object.assign({}, ...Array.from(fs, ([uri, contents]: [string, string]) => ({ [uri]: { uri, relativePath: "", contents } })));

const parseSrcProp = (prefix: string, minSrcs: number, maxSrcs: number, expectF: (syms: ScalaSymbol[], sn: string, s: string[]) => void) => () =>
  fc.assert(fc.property(fc.array(arbSpaces, minSrcs + 1, maxSrcs + 1), arbStr, (spaces: string[], symName: string) => {
    const sourceCode = (s: string) => s + prefix + symName;
    const useSpaces = spaces.slice(-1)[0];
    const sources = mkFiles(spaces.slice(0, -1).map((s: string, i: number): [string, string] =>
      [`source-${aToZ[i]}`, sourceCode(s)]).concat([["srcUse", `${useSpaces}${symName}`]]));
    const { files, store, symbols } = algebras(sources);
    Do(identity)(function* () {
      yield store.indexAllFiles();

      const syms: ScalaSymbol[] = yield symbols.symbolsForPos(files)({
        textDocument: { uri: "srcUse" },
        position: { line: 0, character: useSpaces.length }
      });

      expectF(syms, symName, spaces);
    });
  }));

const parseSymTypeSuite = (prefix: string, symKind: SymbolKind) =>
  describe(`${prefix}symbols`, () => {
    it("locates all definitions of the symbol", parseSrcProp(prefix, 1, 20, (syms: ScalaSymbol[], _: string, spaces: string[]) =>
      expect(syms.length).toEqual(spaces.length - 1)));

    it("chooses the correct symbol type", parseSrcProp(prefix, 1, 20, (syms: ScalaSymbol[]) =>
      syms.forEach((sym: ScalaSymbol) => expect(sym.kind).toEqual(symKind))));

    it("uses the correct symbol name", parseSrcProp(prefix, 1, 20, (syms: ScalaSymbol[], symName: string) =>
      syms.forEach((sym: ScalaSymbol) => expect(sym.rawName).toEqual(symName))));

    it("uses the correct file URI", parseSrcProp(prefix, 1, 20, (syms: ScalaSymbol[]) =>
      syms.forEach((sym: ScalaSymbol, i: number) => expect(sym.file.uri).toEqual(`source-${aToZ[i]}`))));

    it("finds the correct location", parseSrcProp(prefix, 1, 20, (syms: ScalaSymbol[], _: string, spaces: string[]) =>
      syms.forEach((sym: ScalaSymbol, i: number) => expect(sym.location).toEqual({ line: 0, character: (spaces[i] + prefix).length }))));
  });

describe("regex symbols", () => {
  parseSymTypeSuite("class ", SymbolKind.Class);
  parseSymTypeSuite("trait ", SymbolKind.Interface);
  parseSymTypeSuite("object ", SymbolKind.Class);
  parseSymTypeSuite("val ", SymbolKind.Variable);
  parseSymTypeSuite("def ", SymbolKind.Function);
  parseSymTypeSuite("type ", SymbolKind.TypeParameter);
});
