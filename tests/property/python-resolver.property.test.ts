/**
 * python-resolver.property.test.ts — Phase 4f T375 — fast-check invariants
 * for the Python resolver pipeline.
 *
 * 3 properties × 100 iterations each. Generators emit module specifiers
 * across stdlib / third-party / relative shapes; the assertions verify
 * classification + relative-spec parsing determinism.
 */

import { fc, test as fctest } from '@fast-check/vitest';
import { PYTHON_STDLIB_MODULES, isPythonStdlib, parseRelativeSpec } from '@fugazi/graph';
import { describe, expect } from 'vitest';

const STDLIB_SAMPLE = ['os', 'sys', 'json', 'collections', 'pathlib', 'urllib', 'typing'] as const;
const THIRD_PARTY = ['flask', 'fastapi', 'pydantic', 'requests', 'numpy', 'sqlalchemy'] as const;

// --------------------------------------------------------------------------
// Property A — stdlib classification: any name in PYTHON_STDLIB_MODULES (or
// a dotted submodule of one) must classify as stdlib; third-party must not.
// --------------------------------------------------------------------------

describe('python-resolver: stdlib classification', () => {
  fctest.prop([fc.constantFrom(...STDLIB_SAMPLE)], { numRuns: 100 })(
    'every sampled stdlib head classifies as stdlib',
    (mod) => {
      expect(PYTHON_STDLIB_MODULES.has(mod)).toBe(true);
      expect(isPythonStdlib(mod)).toBe(true);
      expect(isPythonStdlib(`${mod}.sub.deeper`)).toBe(true);
    },
  );

  fctest.prop([fc.constantFrom(...THIRD_PARTY)], { numRuns: 100 })(
    'every sampled third-party head classifies as non-stdlib',
    (mod) => {
      expect(PYTHON_STDLIB_MODULES.has(mod)).toBe(false);
      expect(isPythonStdlib(mod)).toBe(false);
    },
  );
});

// --------------------------------------------------------------------------
// Property B — Relative resolution: dot-prefixed specifier always parses to
// a non-null { level, parts } shape, with level === leading-dot count.
// --------------------------------------------------------------------------

describe('python-resolver: relative parse determinism', () => {
  const dotsArb = fc.integer({ min: 1, max: 5 });
  const tailArb = fc.constantFrom('', 'foo', 'foo.bar', 'foo.bar.baz');

  fctest.prop([dotsArb, tailArb], { numRuns: 100 })(
    'parseRelativeSpec recognises every dot-prefixed input',
    (level, tail) => {
      const src = '.'.repeat(level) + tail;
      const parsed = parseRelativeSpec(src);
      expect(parsed).not.toBeNull();
      if (parsed === null) return;
      expect(parsed.level).toBe(level);
      if (tail === '') {
        expect(parsed.parts.length).toBe(0);
      } else {
        const expected = tail.split('.');
        expect([...parsed.parts]).toEqual(expected);
      }
    },
  );

  fctest.prop([fc.constantFrom('os', 'sys', 'foo', 'pkg.sub')], { numRuns: 100 })(
    'parseRelativeSpec returns null for non-relative specifiers',
    (mod) => {
      expect(parseRelativeSpec(mod)).toBeNull();
    },
  );
});

// --------------------------------------------------------------------------
// Property C — Determinism: same input → same Resolution across runs.
// --------------------------------------------------------------------------

describe('python-resolver: determinism', () => {
  const allArb = fc.oneof(fc.constantFrom(...STDLIB_SAMPLE), fc.constantFrom(...THIRD_PARTY));

  fctest.prop([allArb], { numRuns: 100 })(
    'isPythonStdlib produces the same answer twice',
    (mod) => {
      const a = isPythonStdlib(mod);
      const b = isPythonStdlib(mod);
      expect(b).toBe(a);
    },
  );
});
