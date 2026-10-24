// Styles live in a .css file next to the component and are imported from its code;
// esbuild bundles them into styles.css. TypeScript 7 also checks side-effect
// imports (noUncheckedSideEffectImports); this declaration lets them through.
declare module '*.css';
