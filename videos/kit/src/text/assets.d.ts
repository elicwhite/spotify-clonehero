// Remotion's webpack config emits font imports as asset URLs.
declare module '*.woff2' {
  const src: string;
  export default src;
}
