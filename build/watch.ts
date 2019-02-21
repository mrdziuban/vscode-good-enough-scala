import * as chokidar from "chokidar";
import { compileAll, srcDir as syntaxSrcDir } from "./syntax";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";

// const procs: ChildProcess[] = [];
const rootDir = path.resolve(__dirname, "..");
const cleanupFns: (() => void)[] = [];
let exiting = false;

const tryCatch = (action: string) => async (f: () => any) => {
  try { await f(); } catch (e) { console.error(`Error ${action}:`, e); }
};

const restart = (msg: string, ...args: any[]) => (f: () => any) => exiting || (() => {
  console.error(`${msg}, restarting...`, ...args);
  f();
});

const killProc = (proc: ChildProcess) => () => proc.killed || proc.kill();

const tsWatch = (proj: "client" | "server") => {
  const watcher = spawn("yarn", [`compile:${proj}`, "--watch", "--preserveWatchOutput"], { cwd: rootDir });
  watcher.stdout.on("data", (data: any) => console.log(`${proj} stdout: ${data}`));
  watcher.stderr.on("data", (data: any) => console.log(`${proj} stderr: ${data}`));
  watcher.on("close", (code: number) => restart(`${proj} watcher exited with code ${code}`)(() => tsWatch(proj)));
  cleanupFns.push(killProc(watcher));
};

const syntaxWatch = () => {
  const watcher = chokidar.watch(syntaxSrcDir)
    .on("all", () => tryCatch("compiling syntax")(compileAll))
    .on("error", (e: any) => restart("Syntax watcher errored", e)(syntaxWatch));
  cleanupFns.push(() => watcher.close())
};

const cleanup = async () => await cleanupFns.map(tryCatch("cleaning up"));

process.on("SIGINT", cleanup)

tsWatch("client");
tsWatch("server");
syntaxWatch();

process.stdin.resume();
