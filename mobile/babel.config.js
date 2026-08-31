module.exports = (api) => {
  api.cache(true);
  // `nativewind/babel` is a preset (it resolves to `{ plugins: [...] }`), not a plugin.
  return { presets: ["babel-preset-expo", "nativewind/babel"] };
};
