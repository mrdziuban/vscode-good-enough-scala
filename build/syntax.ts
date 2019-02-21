import { json } from "@speedy/json-extends";
import * as fs from "fs";
import * as path from "path";

export const srcDir = path.resolve(__dirname, "..", "src", "syntax");
export const outDir = path.resolve(__dirname, "..", "out", "syntax");

const mkOut = () => outDir.split(path.sep).reduce((prev: string, d: string) => {
  const curr = path.join(prev, d, path.sep);
  if (!fs.existsSync(curr)) {
    fs.mkdirSync(curr);
  }
  return curr;
}, "");

const writeJson = (file: string) => {
  const obj: any = json.readSync(path.join(srcDir, file));
  delete obj.extends;
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(obj));
};

export const compileSyntax = (name: string) => {
  console.log(`Compiling ${name} syntax...`);
  mkOut();
  writeJson(`${name}-config.json`);
  writeJson(`${name}.tmLanguage.json`);
};

export const compileAll = () => ["routes", "twirl"].forEach(compileSyntax);

compileAll();
