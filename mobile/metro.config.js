const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot, { isTsconfigPathsEnabled: true });

// `shared/` sits outside this project, so Metro is told to watch it, and this app's
// node_modules is named explicitly so that a package imported from up there — `zod`,
// via shared/types.ts — resolves here rather than against the web app's copy. Checked
// against the export's source map: every one of the ~1,550 bundled modules comes from
// this directory, and none from the repo root.
config.watchFolders = [path.join(repoRoot, "shared")];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];

module.exports = withNativewind(config);
