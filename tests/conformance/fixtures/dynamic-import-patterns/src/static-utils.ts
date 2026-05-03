export function render(input: string): string {
  return `<page>${input}</page>`;
}

export function unusedRender(): string {
  return '';
}

// Duplicate-export note: render is also exported from pages/about.ts under the
// same name, but they live in different files — the duplicate-exports rule
// flags only same-name exports across modules that share consumer paths.
