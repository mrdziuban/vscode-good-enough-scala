declare interface CommandExists { sync(cmd: string): boolean }
declare var commandExists: CommandExists;
declare module "command-exists" { export = commandExists }
