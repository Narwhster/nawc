/// <reference types="vite/client" />
declare module "virtual:nawc-plugins" {
  import type { NawcClientPlugin } from "@nawc/plugin";
  const plugins: readonly NawcClientPlugin[];
  export default plugins;
}
