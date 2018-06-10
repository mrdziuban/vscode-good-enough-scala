import { Connection, DidChangeConfigurationParams } from "vscode-languageserver";

interface Settings {
  analyticsEnabled: boolean;
  hoverEnabled: boolean;
}
const defaultSettings: Settings = {
  analyticsEnabled: true,
  hoverEnabled: true
};
let settings: Settings = defaultSettings;

let hasWorkspaceConfig = false;

const Settings = {
  get: () => settings,

  hasWorkspaceConfig: () => hasWorkspaceConfig,

  update: <A, B, C, D, E>(connection: Connection<A, B, C, D, E>) => (params?: DidChangeConfigurationParams) => {
    if (hasWorkspaceConfig) {
      connection.workspace.getConfiguration("goodEnoughScala").then((s: Settings) => {
        connection.console.log(`Scala settings changed: ${JSON.stringify(s)}`);
        settings = s;
      });
    } else if (params && params.settings) {
      connection.console.log(`Scala settings changed: ${JSON.stringify(params.settings.goodEnoughScala)}`);
      settings = params.settings.goodEnoughScala || defaultSettings;
    }
  },

  updateHasWorkspaceConfig: (hwc: boolean) => hasWorkspaceConfig = hwc,
};

export default Settings;
