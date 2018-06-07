import {
  createConnection,
  Hover,
  Location,
  ProposedFeatures,
  TextDocuments,
  TextDocumentPositionParams,
  WorkspaceFolder,
  MarkupKind
} from "vscode-languageserver";
import * as fs from "fs";
import * as path from "path";
import * as url from "url"

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments();
documents.listen(connection);

connection.onInitialize(() => ({
  capabilities: {
    definitionProvider: true,
    hoverProvider: true,
    textDocumentSync: documents.syncKind
  }
}));

function symName(name: string): string { return `__SCALA_SYMBOL__${name}`; }

function flatten<A>(arr: A[][]): A[] { return [].concat.apply([], arr); }

function now(): number { return +(new Date()); }

function sortBy<A, B>(fn: (a: A) => B, arr: A[]): A[] {
  const sorters = {
    number: (x: number, y: number): number => x - y,
    any: (x: any, y: any): number => x < y ? -1 : (x > y) ? 1 : 0
  };
  return arr.sort((a1: A, a2: A) => {
    const [b1, b2] = [fn(a1), fn(a2)];
    return (typeof b1 === "number" && typeof b2 === "number")
      ? sorters.number(b1, b2)
      : sorters.any(b1, b2);
  });
}

interface ScalaFile {
  absolutePath: string;
  relativePath: string;
};

function getScalaFiles(dir: string, files: string[] = []): string[] {
  return files.concat(flatten(fs.readdirSync(dir).map((file: string) => {
    const joined = path.resolve(path.join(dir, file));
    return fs.statSync(joined).isDirectory()
      ? getScalaFiles(joined, files)
      : (/\.scala$/.test(joined) ? [joined] : []);
  })));
}

interface ScalaSymbol {
  symbolName: string;
  file: ScalaFile;
  location: { line: number; character: number; };
}

// type IndexedFiles = { [file: string]: { [sym: string]: number[] } };
// let indexedFiles: IndexedFiles = {};

type Symbols = { [sym: string]: ScalaSymbol[] };
let symbols: Symbols = {};

// function updateIndexedFiles(): void {
//   indexedFiles = Object.keys(symbols).reduce(
//     (acc: IndexedFiles, s: string) => {
//       symbols[s].forEach((sym: ScalaSymbol, idx: number) => {
//         const abs = sym.file.absolutePath;
//         acc[abs] = acc[abs] || {};
//         acc[abs][sym.symbolName] = acc[abs][sym.symbolName] || [];
//         acc[abs][sym.symbolName].push(idx);
//       });
//       return acc;
//     },
//     {});
// }

type SymbolExtractor = (f: ScalaFile, c: string) => ScalaSymbol[];

function extractMatches(rx: RegExp, symbolType: string, file: ScalaFile): (line: string, lineNum: number) => ScalaSymbol[] {
  return (line: string, lineNum: number) => {
    const offset = symbolType.length + 2;
    const retVal = [];
    let matches = rx.exec(line);
    while (!!matches) {
      retVal.push({
        symbolName: symName(matches[1]),
        file,
        location: { line: lineNum, character: matches.index + offset }
      });
      matches = rx.exec(line);
    }
    return retVal;
  };
}

const alphaRx = /[a-zA-Z]/;
const termRx = new RegExp(`[${alphaRx.source.slice(1, -1)}0-9_]`);

function defaultExtractor(symbolType: string): (f: ScalaFile, c: string) => ScalaSymbol[] {
  return (file: ScalaFile, contents: string) => {
    const rx = new RegExp(`${symbolType} (${alphaRx.source}${termRx.source}+)`, "g");
    return flatten(contents.split("\n").map(extractMatches(rx, symbolType, file)));
  };
}

const symbolExtractors: SymbolExtractor[] = [
  defaultExtractor("class"),
  defaultExtractor("trait"),
  defaultExtractor("object"),
  defaultExtractor("val"),
  defaultExtractor("def")
];

function getScalaSymbols(file: ScalaFile): ScalaSymbol[] {
  const contents = fs.readFileSync(file.absolutePath).toString();
  return flatten(symbolExtractors.map((ex: SymbolExtractor) => ex(file, contents)));
}

function update(): void {
  const start = now();
  connection.workspace.getWorkspaceFolders()
    .then((fldrs: WorkspaceFolder[] | null) => {
      const folders = flatten((fldrs || [])
        .filter((f: WorkspaceFolder) => /^file:\/\//i.test(f.uri))
        .map((f: WorkspaceFolder) => {
          const path = url.parse(f.uri).path;
          return !!path ? [[f, path]] : [];
        }));
      return flatten(folders.map(([_, dir]: [WorkspaceFolder, string]): ScalaFile[] => {
        const files = getScalaFiles(dir);
        return files.map((f: string) => ({ absolutePath: f, relativePath: f.replace(`${dir}/`, "") }));
      }));
    })
    .then((files: ScalaFile[]) =>
      Promise.all(files.map((file: ScalaFile) =>
        new Promise((resolve: (syms: ScalaSymbol[]) => void) => resolve(getScalaSymbols(file))))))
    // This is the wrong type but the compiler is complaining. See cast below.
    .then((symsPromise: Promise<ScalaSymbol[][]>) => {
      symbols = flatten(<any>symsPromise as ScalaSymbol[][]).reduce((acc: Symbols, sym: ScalaSymbol) => {
        acc[sym.symbolName] = (acc[sym.symbolName] || []).concat([sym]);
        return acc;
      }, {});
      // updateIndexedFiles();
      connection.console.log(`Finished indexing ${Object.keys(symbols).length} scala symbols in ${now() - start}ms`);
    });
}

connection.onInitialized(update);

function buildTerm(line: string, char: number): string {
  const append = (term: string, changeIdx: (i: number) => number, concat: (newChar: string, term: string) => string): string => {
    let idx = changeIdx(char);
    while (line[idx] && termRx.test(line[idx])) {
      term = concat(line[idx], term);
      idx = changeIdx(idx);
    }
    return term;
  };

  let term = line[char];
  term = append(term, (i: number) => i - 1, (c: string, t: string) => c + t);
  term = append(term, (i: number) => i + 1, (c: string, t: string) => t + c);
  return term;
}

function getTerm(tdp: TextDocumentPositionParams): string | undefined {
  const file = url.parse(tdp.textDocument.uri).path;
  if (!file) { return; }
  const line = fs.readFileSync(file).toString().split("\n")[tdp.position.line];
  return symName(buildTerm(line, tdp.position.character));
}

connection.onDefinition((tdp: TextDocumentPositionParams): Location[] => {
  const term = getTerm(tdp);
  return ((term && symbols[term]) || []).map((sym: ScalaSymbol) =>
    Location.create(`file://${sym.file.absolutePath}`, { start: sym.location, end: sym.location }));
});

connection.onHover((tdp: TextDocumentPositionParams): Hover | undefined => {
  const term = getTerm(tdp);
  return (term && symbols[term])
    ? {
      contents: {
        kind: MarkupKind.Markdown,
        value: sortBy((sym: ScalaSymbol) => sym.file.absolutePath, symbols[term]).map((sym: ScalaSymbol) => {
          const line = `${sym.location.line + 1},${sym.location.character}`;
          return `- [${sym.file.relativePath}:${line}](file://${sym.file.absolutePath}#L${line})`;
        }).join("\n")
      }
    }
    : undefined;
});

connection.onDidSaveTextDocument(update);

connection.listen();
