declare module '*.png' {
  // Asset declarations need an inline type query because this file must remain ambient.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
