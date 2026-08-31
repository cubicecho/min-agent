const path = require("node:path");

// `nativewind/babel` is a preset (it resolves to `{ plugins: [...] }`), not a plugin.
const nativewindPreset = require("nativewind/babel").default;

// One of the plugins in that preset rewrites imports of react-native-web's components to
// react-native-css's className-aware wrappers, which is how `className` reaches a `<View>`
// on web. It fires on every file, including react-native-web's own source — and that is a
// cycle. `exports/FlatList/index.js` and `vendor/.../Animated/components/AnimatedFlatList.js`
// both end up importing the wrapper, the wrapper imports the `react-native` barrel, and the
// barrel is what was half-way through loading FlatList in the first place. Its `FlatList`
// getter then reads `.default` off a binding that has not been assigned yet, so the whole app
// dies at import time with `Cannot read properties of undefined (reading 'default')`.
//
// react-native-css's Metro resolver already refuses to rewrite anything inside
// react-native-web; its Babel plugin has no equivalent guard, so this adds one. Nothing is
// lost: the wrappers are still substituted where an application — or any other package —
// imports a component, which is the only place className has to work.
const REACT_NATIVE_WEB = path.join("react-native-web", "dist") + path.sep;

const skipReactNativeWebInternals = (plugin) => (babel) => {
  const { visitor, ...rest } = plugin(babel);

  return {
    ...rest,
    visitor: Object.fromEntries(
      Object.entries(visitor).map(([node, visit]) => [
        node,
        (nodePath, state) => {
          if (!state.filename?.includes(REACT_NATIVE_WEB)) {
            visit(nodePath, state);
          }
        },
      ]),
    ),
  };
};

module.exports = (api) => {
  api.cache(true);

  const { plugins, ...preset } = nativewindPreset();

  return {
    presets: [
      "babel-preset-expo",
      {
        ...preset,
        plugins: plugins.map((plugin) =>
          typeof plugin === "function" ? skipReactNativeWebInternals(plugin) : plugin,
        ),
      },
    ],
  };
};
