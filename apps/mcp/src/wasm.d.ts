declare module '*.wasm' {
  const m: WebAssembly.Module;
  export default m;
}

declare module '*?raw' {
  const text: string;
  export default text;
}
