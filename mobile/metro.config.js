const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot, { isTsconfigPathsEnabled: true });

// `shared/` sits outside this project, so Metro is told to watch it. Hierarchical
// lookup is then switched off so that a module imported from up there resolves
// against this app's node_modules rather than the web app's — otherwise Metro finds
// the root's copy of React and the app renders with two of them.
config.watchFolders = [path.join(repoRoot, "shared")];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativewind(config);
