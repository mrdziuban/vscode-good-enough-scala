import { Type, URIS } from "fp-ts/lib/HKT";
import { Monad1 } from "fp-ts/lib/Monad";
import { DidChangeConfigurationParams } from "vscode-languageserver";
import { autobind, Do, prop } from "../util";
import { MkRef } from "./ref";

export interface SettingsT {
  analyticsEnabled: boolean;
  hoverEnabled: boolean;
}

export const defaultSettingsT: SettingsT = {
  analyticsEnabled: true,
  hoverEnabled: true
};

export interface Settings<M extends URIS> {
  get: <K extends keyof SettingsT>(key: K) => Type<M, SettingsT[K]>;
  hasWorkspaceConfig: Type<M, boolean>;
  updateHasWorkspaceConfig: (hwc: boolean) => Type<M, void>;
  update: (params?: DidChangeConfigurationParams) => Type<M, void>;
}

export const defaultSettings = <M extends URIS>(M: Monad1<M>, R: MkRef<M>) => (getWorkspaceSettings: () => Type<M, SettingsT>): Settings<M> => {
  const settingsRef = autobind(R(defaultSettingsT));
  const hasWorkspaceConfigRef = autobind(R(false));
  return {
    get: <K extends keyof SettingsT>(key: K): Type<M, SettingsT[K]> => M.map(settingsRef.read(), prop(key)),
    hasWorkspaceConfig: hasWorkspaceConfigRef.read(),
    updateHasWorkspaceConfig: hasWorkspaceConfigRef.write,
    update: (params?: DidChangeConfigurationParams) => Do(M)<void>(function*() {
      const hasWorkspaceConfig = yield hasWorkspaceConfigRef.read();
      const settings: SettingsT = yield hasWorkspaceConfig ? getWorkspaceSettings() : M.of(params && params.settings ? params.settings : defaultSettingsT);
      yield settingsRef.write(settings);
    })
  };
};
