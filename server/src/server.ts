import {
  createConnection,
  Location,
  ProposedFeatures,
  TextDocuments,
  TextDocumentPositionParams,
  WorkspaceFolder
} from "vscode-languageserver";
import * as fs from "fs";
import * as path from "path";
import * as url from "url"

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments = new TextDocuments();

connection.onInitialize(() => ({ capabilities: { definitionProvider: true } }));

function flatten<A>(arr: A[][]): A[] { return [].concat.apply([], arr); }

function getScalaFiles(dir: string, files: string[] = []): string[] {
  return files.concat(flatten(fs.readdirSync(dir).map((file: string) => {
    const joined = path.resolve(path.join(dir, file));
    if (fs.statSync(joined).isDirectory()) {
      return getScalaFiles(joined, files);
    } else if (/\.scala$/.test(joined)) {
      return [joined];
    } else {
      return [];
    }
  })));
}

type StrObj<V> = { [k: string]: V };

interface ScalaSymbol {
  symbolName: string;
  file: string;
  location: { line: number; character: number; };
}

const indexedFiles: StrObj<(() => void)[]> = {};
const symbols: StrObj<ScalaSymbol[]> = {};

function updateIndexedFiles(): void {
  Object.keys(symbols).forEach((sym: string) => {
    symbols[sym].forEach((symbol: ScalaSymbol, idx: number) => {
      indexedFiles[symbol.file] = indexedFiles[symbol.file] || [];
      // TODO - figure out splice
      indexedFiles[symbol.file].push(() => symbols[sym] = symbols[sym].splice(1, idx));
      indexedFiles[symbol.file].push(() => symbols[sym].filter((s: ScalaSymbol) => s !== symbol));
    });
  });
}


type SymbolExtractor = (f: string, c: string) => ScalaSymbol[];

function extractMatches(rx: RegExp, symbolType: string, file: string): (line: string, lineNum: number) => ScalaSymbol[] {
  return (line: string, lineNum: number) => {
    const offset = symbolType.length + 1;
    const retVal = [];
    let matches = rx.exec(line);
    while (!!matches) {
      retVal.push({
        symbolName: matches[1],
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

function defaultExtractor(symbolType: string): (f: string, c: string) => ScalaSymbol[] {
  return (file: string, contents: string) => {
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

function getScalaSymbols(file: string): ScalaSymbol[] {
  const contents = fs.readFileSync(file).toString();
  return flatten(symbolExtractors.map((ex: SymbolExtractor) => ex(file, contents)));
}

connection.onInitialized(() => {
  connection.workspace.getWorkspaceFolders()
    .then((fldrs: WorkspaceFolder[] | null) => {
      const folders = flatten((fldrs || [])
        .filter((f: WorkspaceFolder) => /^file:\/\//i.test(f.uri))
        .map((f: WorkspaceFolder) => {
          const path = url.parse(f.uri).path;
          return !!path ? [[f, path]] : [];
        }));
      return flatten(folders.map((t: [WorkspaceFolder, string]) => getScalaFiles(t[1])));
    })
    .then((files: string[]) =>
      Promise.all(files.map((file: string) =>
        new Promise((resolve: (syms: ScalaSymbol[]) => void) => resolve(getScalaSymbols(file))))))
    // This is the wrong type but the compiler is complaining. See cast below.
    .then((symsPromise: Promise<ScalaSymbol[][]>) => {
      const syms: ScalaSymbol[] = flatten(<any>symsPromise as ScalaSymbol[][]);
      syms.forEach((sym: ScalaSymbol) => {
        symbols[sym.symbolName] = symbols[sym.symbolName] || [];
        symbols[sym.symbolName].push(sym);
      });
      updateIndexedFiles();
      connection.console.log("finished indexing");
      connection.console.log(JSON.stringify(symbols, null, 2));
    });
});

// TODO
// connection.onDidChangeWorkspaceFolders()
// connection.onHover()

function buildTerm(line: string, char: number): string {
  const append = (term: string, changeIdx: (i: number) => number, concat: (newChar: string, term: string) => string): string => {
    let idx = changeIdx(char);
    while (termRx.test(line[idx])) {
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

connection.onDefinition((tdp: TextDocumentPositionParams): Location[] => {
  const file = url.parse(tdp.textDocument.uri).path;
  if (!file) { return []; }
  const line = fs.readFileSync(file).toString().split("\n")[tdp.position.line];
  const term = buildTerm(line, tdp.position.character);
  return (symbols[term] || []).map((symbol: ScalaSymbol) =>
    Location.create(`file://${symbol.file}`, { start: symbol.location, end: symbol.location }));
});

// // This handler provides the initial list of the completion items.
// connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
//   // The pass parameter contains the position of the text document in
//   // which code complete got requested. For the example we ignore this
//   // info and always provide the same completion items.
//   return [
//   {
//     label: 'TypeScript',
//     kind: CompletionItemKind.Text,
//     data: 1
//   },
//   {
//     label: 'JavaScript',
//     kind: CompletionItemKind.Text,
//     data: 2
//   }
//   ]
// });

// // This handler resolve additional information for the item selected in
// // the completion list.
// connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
//   if (item.data === 1) {
//     item.detail = 'TypeScript details',
//     item.documentation = 'TypeScript documentation'
//   } else if (item.data === 2) {
//     item.detail = 'JavaScript details',
//     item.documentation = 'JavaScript documentation'
//   }
//   return item;
// });

/*
connection.onDidOpenTextDocument((params) => {
  // A text document got opened in VSCode.
  // params.uri uniquely identifies the document. For documents store on disk this is a file URI.
  // params.text the initial full content of the document.
  connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
  // The content of a text document did change in VSCode.
  // params.uri uniquely identifies the document.
  // params.contentChanges describe the content changes to the document.
  connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
  // A text document got closed in VSCode.
  // params.uri uniquely identifies the document.
  connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
