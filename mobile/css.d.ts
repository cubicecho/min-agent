// TypeScript 6 rejects a side-effect import with no declaration behind it (TS2882), and
// `app/_layout.tsx` imports `global.css` purely so Metro compiles Tailwind into the bundle.
declare module "*.css";
