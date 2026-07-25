import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rootPackage = readPackage("package.json");
const releaseTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
const expectedTag = `v${rootPackage.version}`;
const expectedRepository = "git+https://github.com/Narwhster/nawc.git";

if (releaseTag !== expectedTag) {
  throw new Error(`Release tag ${JSON.stringify(releaseTag)} must match ${expectedTag}.`);
}

const workspaceRoots = ["packages", "plugins", "provider", "editor", "theme"];
const packages = workspaceRoots.flatMap((workspaceRoot) =>
  fs
    .readdirSync(path.join(root, workspaceRoot), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(workspaceRoot, entry.name, "package.json");
      return { file, manifest: readPackage(file) };
    }),
);
const publishable = packages.filter(({ manifest }) => manifest.private !== true);

if (publishable.length !== 27) {
  throw new Error(`Expected 27 publishable packages, found ${publishable.length}.`);
}

const mismatched = publishable.filter(({ manifest }) => manifest.version !== rootPackage.version);
if (mismatched.length > 0) {
  throw new Error(
    `All publishable packages must be version ${rootPackage.version}: ${mismatched
      .map(({ file, manifest }) => `${file} is ${manifest.version}`)
      .join(", ")}`,
  );
}

for (const { file, manifest } of publishable) {
  if (manifest.repository?.url !== expectedRepository) {
    throw new Error(`${file} must use repository ${expectedRepository}.`);
  }
  if (manifest.publishConfig?.access !== "public") {
    throw new Error(`${file} must publish with public access.`);
  }
  if (manifest.publishConfig?.registry !== "https://registry.npmjs.org/") {
    throw new Error(`${file} must publish to the public npm registry.`);
  }
}

console.log(`Release ${expectedTag} contains ${publishable.length} public packages.`);

function readPackage(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}
