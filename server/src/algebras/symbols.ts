import { Type, URIS } from "fp-ts/lib/HKT";
import { Location, SymbolKind, TextDocumentPositionParams } from "vscode-languageserver";
import { File, Files, ScalaFile } from "./files";

const symPrefix = "__SCALA_SYMBOL__";
export const symName = (name: string) => `${symPrefix}${name}`;

export interface ScalaSymbol {
  name: string;
  rawName: string;
  kind: SymbolKind;
  file: ScalaFile;
  location: { line: number; character: number; };
}

export interface SymbolCache { [sym: string]: ScalaSymbol[]; }

export interface CharRange { start: number; end: number; }
export interface Term { term: string; range: CharRange; }

export interface Symbols<M extends URIS> {
  search: (query: string) => Type<M, ScalaSymbol[]>;
  update: (filesToIndex: File[]) => Type<M, ScalaSymbol[]>;
  getTerm: (files: Files<M>) => (tdp: TextDocumentPositionParams) => Type<M, Term>;
  symbolsForPos: (files: Files<M>) => (tdp: TextDocumentPositionParams) => Type<M, ScalaSymbol[]>;
}

export const symToUri = (sym: ScalaSymbol) => sym.file.uri;
export const symToLoc = (sym: ScalaSymbol) => Location.create(symToUri(sym), { start: sym.location, end: sym.location });
