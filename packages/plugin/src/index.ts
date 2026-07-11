export type NawcSkill = {
  readonly name: string;
  readonly content: string;
};

export type NawcNode = {
  readonly name: string;
  readonly tag: string;
  readonly description: string;
};

export type NawcPlugin = {
  readonly name: string;
  /** Browser module imported by the notebook's generated Vite entry. */
  readonly client: string;
  readonly nodes?: readonly NawcNode[];
  readonly skills?: readonly NawcSkill[];
};

export type NawcClientPlugin = {
  readonly name: string;
  readonly extensions: readonly AnyExtension[];
};

export function definePlugin<const T extends NawcPlugin>(plugin: T): T {
  return plugin;
}
import type { AnyExtension } from "@tiptap/core";
