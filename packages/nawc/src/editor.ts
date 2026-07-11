import { spawn } from "node:child_process";
import type { EditorLocation, EditorTarget, NawcEditor } from "@nawc/config";

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
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else
          reject(new Error(`Could not open ${editor.label} (launcher exited with code ${code})`));
      });
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}
