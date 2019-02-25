import { URIS } from "fp-ts/lib/HKT";
import { Analytics } from "./analytics";
import { CodeActions } from "./codeActions";
import { Files } from "./files";
import { Log } from "./log";
import { Settings } from "./settings";
import { Store } from "./store";
import { Symbols } from "./symbols";

export interface Algebras<M extends URIS> {
  analytics: Analytics<M>;
  codeActions: CodeActions<M>;
  files: Files<M>;
  log: Log<M>;
  settings: Settings<M>;
  store: Store<M>;
  symbols: Symbols<M>;
}
