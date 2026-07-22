declare module "virtual:nawc-plugins" {
  export const syntaxes: readonly {
    readonly name: string;
    readonly aliases: readonly string[];
    readonly highlight?: string;
  }[];
}
