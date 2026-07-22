import { spawn } from "node:child_process";
import type { EditorLocation, EditorTarget, NawcEditor } from "@nawc/config";

const CLI_INSTALL_HINTS: Readonly<Record<string, string>> = {
  vscode: "Open the Command Palette and run 'Shell Command: Install code command in PATH'.",
  idea: "In the IDE use Tools → Create Command-line Launcher, or add the install's bin directory to your PATH. Toolbox users: Settings → Generate shell scripts.",
  webstorm:
    "In the IDE use Tools → Create Command-line Launcher, or add the install's bin directory to your PATH. Toolbox users: Settings → Generate shell scripts.",
  clion:
    "In the IDE use Tools → Create Command-line Launcher, or add the install's bin directory to your PATH. Toolbox users: Settings → Generate shell scripts.",
  zed: "Install the Zed CLI: open Zed → Command Palette → 'cli: install cli binary'.",
  cursor: "Open the Command Palette and run 'Shell Command: Install cursor command in PATH'.",
};

function installHint(editorName: string): string {
  return (
    CLI_INSTALL_HINTS[editorName] ??
    "Make sure the editor's CLI is installed and available on your PATH."
  );
}

function commandNotFoundError(editor: NawcEditor, command: string): Error {
  return new Error(
    `Could not find the "${command}" command for ${editor.label}. ${installHint(editor.name)}`,
  );
}

export function urlOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  if (platform === "darwin") return ["open", url];
  if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  return ["xdg-open", url];
}

export async function launchEditor(editor: NawcEditor, location: EditorLocation): Promise<void> {
  const target: EditorTarget = editor.open(location);
  const [command, ...args] = target.type === "url" ? urlOpenCommand(target.url) : target.command;
  if (!command) throw new Error(`Editor ${editor.name} returned an empty command`);
  const child = spawn(command, args, { detached: target.type === "command", stdio: "ignore" });
  if (target.type === "url") {
    await new Promise<void>((resolve, reject) => {
      child.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") reject(commandNotFoundError(editor, command));
        else reject(err);
      });
      child.once("close", (code) => {
        if (code === 0) resolve();
        else
          reject(new Error(`Could not open ${editor.label} (launcher exited with code ${code})`));
      });
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    child.once("error", (err: NodeJS.ErrnoException) => {
      settle(() => {
        if (err.code === "ENOENT") reject(commandNotFoundError(editor, command));
        else reject(err);
      });
    });
    child.once("spawn", () => settle(() => resolve()));
  });
  child.unref();
}
