// No default export — should still load (the loader returns the module
// namespace when no default is present, leaving validation to the schema).
export const config = {
  rules: {
    'unused-files': 'error',
  },
};
