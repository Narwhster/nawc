import type { NawcConfig, NawcEditor, NawcTheme } from "@nawc/config";
import { configShape } from "@nawc/config";
import { vscode } from "@nawc/editor-vscode";
import { nawcLight } from "@nawc/theme-nawc";

export function defineConfig<const T extends NawcConfig>(
  config: T,
): T & { readonly editor: NawcEditor; readonly theme: NawcTheme } {
  configShape.parse(config);
  return { ...config, editor: config.editor ?? vscode(), theme: config.theme ?? nawcLight() };
}
