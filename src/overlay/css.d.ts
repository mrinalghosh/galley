// esbuild loads .css as text (scripts/build.mjs); the overlay injects it into its shadow root.
declare module '*.css' {
  const text: string;
  export default text;
}
