/**
 * adapter.ts — Phase 4a T304 — tree-sitter Tree → discriminated-union AST.
 *
 * `parsePythonAst(source, filename)` lifts the raw `web-tree-sitter` `Tree`
 * produced by `./tree-sitter.ts` into the discriminated `PyProgram` shape from
 * `../ast/kinds-py.ts`. The conversion is depth-first, single-pass, and
 * intentionally narrow: every tree-sitter node either maps to a recognised
 * variant or collapses to `UnknownStatement` / `UnknownExpression`. Adding a
 * Python construct is therefore localised to two spots: the per-kind classify
 * helpers below, and the `kinds-py.ts` union plus its walker.
 *
 * Determinism (NFR-1 / SC-15): the adapter walks tree-sitter's own
 * declaration-ordered children with no sort, so two consecutive parses of the
 * same source produce structurally identical `PyProgram` outputs.
 *
 * Range population: tree-sitter's `SyntaxNode` exposes `startIndex` /
 * `endIndex` as 0-based UTF-8 byte offsets and `startPosition` /
 * `endPosition` as 0-based row/column points. Fugazi `Position`
 * (packages/types) carries:
 *   - line:        1-based line number      → row + 1
 *   - column:      0-based UTF-16 column    → tree-sitter's column is in
 *     code units already (the WASM grammar tokenises against the JS string)
 *   - byteOffset:  0-based UTF-8 byte       → startIndex / endIndex verbatim
 *
 * Errors: tree-sitter is fail-soft. The underlying `parsePython` collects
 * `ERROR` and `MISSING` nodes in `result.errors`. `parsePythonAst` translates
 * each into a `ParseError` matching the SWC adapter's verbatim message
 * convention (`parse-error: unexpected '<text>'` / `missing token: <type>`).
 *
 * Per IMP-DEBT-08: this adapter is the bridge to the discriminated union; the
 * original Fallow Rust pipeline's string-sentinel pattern never appears.
 */

import type { Position, Range } from '@fugazi/types';
import type Parser from 'web-tree-sitter';
import type {
  AnnAssign,
  Assign,
  AsyncFunctionDef,
  Attribute,
  AugAssign,
  Await,
  BinOp,
  BoolOp,
  Break,
  Call,
  ClassDef,
  Comprehension,
  Conditional,
  Constant,
  Continue,
  Decorator,
  Dict,
  DictEntry,
  ExpressionStmt,
  FString,
  ForStmt,
  FunctionDef,
  IfStmt,
  ImportFromStmt,
  ImportStmt,
  Lambda,
  List,
  MatchStmt,
  Name,
  Pass,
  PyExpression,
  PyParameter,
  PyProgram,
  Set as PySet,
  PyStatement,
  RaiseStmt,
  ReturnStmt,
  Starred,
  Subscript,
  TryStmt,
  Tuple,
  UnaryOp,
  UnknownExpression,
  UnknownStatement,
  Walrus,
  WhileStmt,
  WithStmt,
  Yield,
  YieldStmt,
} from '../ast/kinds-py.js';
import type { ParseError } from '../parsers/types.js';
import { parsePython } from './tree-sitter.js';

/**
 * Result shape mirrors `parsers/oxc.ts ParseResult` field-for-field. `program`
 * is always populated for Python (tree-sitter is tolerant — even malformed
 * sources yield a partial tree), unlike SWC which sets `program: null` on
 * total failure. Errors are surfaced separately for the rules layer.
 */
export interface PyParseResult {
  readonly program: PyProgram;
  readonly errors: readonly ParseError[];
}

/**
 * `parsePythonAst` — wrap the spike-level `parsePython` and surface a
 * discriminated `PyProgram`. Errors propagate verbatim from the underlying
 * tree-sitter walk; WASM-integrity / WASM-missing failures throw via
 * `parsePython`'s contract, never appear here.
 */
export async function parsePythonAst(source: string, filename: string): Promise<PyParseResult> {
  const ts = await parsePython(source, filename);
  const program = classifyProgram(ts.rootNode, filename);
  const errors: ParseError[] = ts.errors.map((e) => translateError(e, filename, source));
  return { program, errors };
}

// --------------------------------------------------------------------------
// Range conversion
// --------------------------------------------------------------------------

function pointToPosition(byteOffset: number, row: number, column: number): Position {
  return {
    line: row + 1,
    column,
    byteOffset,
  };
}

function rangeOf(node: Parser.SyntaxNode): Range {
  return {
    start: pointToPosition(node.startIndex, node.startPosition.row, node.startPosition.column),
    end: pointToPosition(node.endIndex, node.endPosition.row, node.endPosition.column),
  };
}

// --------------------------------------------------------------------------
// Program / statement entry points
// --------------------------------------------------------------------------

function classifyProgram(root: Parser.SyntaxNode, filename: string): PyProgram {
  const body: PyStatement[] = [];
  for (const child of namedChildren(root)) {
    body.push(classifyStatement(child));
  }
  return {
    kind: 'PyProgram',
    body,
    filename,
    range: rangeOf(root),
  };
}

/**
 * Iterate a tree-sitter node's NAMED children. (Anonymous tokens like `def`,
 * `:`, `(`, `,` are not surfaced — they carry no semantic content for our
 * union and would otherwise collide with `UnknownStatement` collapse.)
 */
function namedChildren(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child !== null) out.push(child);
  }
  return out;
}

function blockBody(block: Parser.SyntaxNode | null): PyStatement[] {
  if (block === null) return [];
  const out: PyStatement[] = [];
  for (const child of namedChildren(block)) {
    out.push(classifyStatement(child));
  }
  return out;
}

function classifyStatement(node: Parser.SyntaxNode): PyStatement {
  const range = rangeOf(node);
  switch (node.type) {
    case 'function_definition':
      return classifyFunctionDef(node, range, false, []);
    case 'class_definition':
      return classifyClassDef(node, range, []);
    case 'decorated_definition':
      return classifyDecorated(node, range);
    case 'import_statement':
      return classifyImport(node, range);
    case 'import_from_statement':
      return classifyImportFrom(node, range);
    case 'expression_statement':
      return classifyExpressionStmt(node, range);
    case 'if_statement':
      return classifyIf(node, range);
    case 'for_statement':
      return classifyFor(node, range);
    case 'while_statement':
      return classifyWhile(node, range);
    case 'try_statement':
      return classifyTry(node, range);
    case 'with_statement':
      return classifyWith(node, range);
    case 'match_statement':
      return classifyMatch(node, range);
    case 'return_statement':
      return classifyReturn(node, range);
    case 'yield_statement':
      // yield_statement is rare in tree-sitter-python (yield usually appears
      // in expression_statement); covered for completeness.
      return classifyYieldStmt(node, range);
    case 'raise_statement':
      return classifyRaise(node, range);
    case 'pass_statement': {
      const pass: Pass = { kind: 'Pass', range };
      return pass;
    }
    case 'break_statement': {
      const br: Break = { kind: 'Break', range };
      return br;
    }
    case 'continue_statement': {
      const cont: Continue = { kind: 'Continue', range };
      return cont;
    }
    default: {
      const unknown: UnknownStatement = { kind: 'UnknownStatement', range };
      return unknown;
    }
  }
}

// --------------------------------------------------------------------------
// Statement classifiers
// --------------------------------------------------------------------------

/**
 * `decorated_definition` wraps a decorator stack plus a `function_definition`
 * or `class_definition`. We collect the decorators from the wrapper, then
 * delegate to the underlying classifier to populate the rest of the shape.
 */
function classifyDecorated(node: Parser.SyntaxNode, range: Range): PyStatement {
  const decorators: Decorator[] = [];
  let definition: Parser.SyntaxNode | null = null;
  for (const child of namedChildren(node)) {
    if (child.type === 'decorator') {
      decorators.push(classifyDecorator(child));
    } else if (child.type === 'function_definition' || child.type === 'class_definition') {
      definition = child;
    }
  }
  const defRange = definition !== null ? rangeOf(definition) : range;
  if (definition !== null && definition.type === 'function_definition') {
    return classifyFunctionDef(definition, defRange, false, decorators);
  }
  if (definition !== null && definition.type === 'class_definition') {
    return classifyClassDef(definition, defRange, decorators);
  }
  // Malformed `@dec\n<garbage>` — collapse the wrapper to UnknownStatement so
  // the visitor still sees a position-bearing node.
  const unknown: UnknownStatement = { kind: 'UnknownStatement', range };
  return unknown;
}

function classifyFunctionDef(
  node: Parser.SyntaxNode,
  range: Range,
  _wrapped: boolean,
  decorators: readonly Decorator[],
): FunctionDef | AsyncFunctionDef {
  // Tree-sitter encodes `async def` as a `function_definition` with an
  // anonymous leading `async` token. Detect by scanning ALL children (not
  // just named) for the keyword.
  const isAsync = hasAnonymousChild(node, 'async');
  const nameNode = node.childForFieldName('name');
  const name = nameNode !== null ? nameNode.text : '';
  const params = classifyParameters(node.childForFieldName('parameters'));
  const body = blockBody(node.childForFieldName('body'));
  if (isAsync) {
    const af: AsyncFunctionDef = {
      kind: 'AsyncFunctionDef',
      range,
      name,
      params,
      body,
      decorators,
    };
    return af;
  }
  const fn: FunctionDef = { kind: 'FunctionDef', range, name, params, body, decorators };
  return fn;
}

function classifyClassDef(
  node: Parser.SyntaxNode,
  range: Range,
  decorators: readonly Decorator[],
): ClassDef {
  const nameNode = node.childForFieldName('name');
  const name = nameNode !== null ? nameNode.text : '';
  // Bases live under field `superclasses`, an `argument_list`. Each
  // positional base is itself an expression; keyword arguments
  // (`metaclass=Meta`) collapse to UnknownExpression — the rules layer
  // doesn't currently inspect them.
  const supers = node.childForFieldName('superclasses');
  const bases: PyExpression[] = [];
  if (supers !== null) {
    for (const child of namedChildren(supers)) {
      if (child.type === 'keyword_argument') continue;
      bases.push(classifyExpression(child));
    }
  }
  const body = blockBody(node.childForFieldName('body'));
  const members: string[] = [];
  for (const stmt of body) {
    if (stmt.kind === 'FunctionDef' || stmt.kind === 'AsyncFunctionDef') {
      members.push(stmt.name);
    } else if (stmt.kind === 'Assign') {
      for (const t of stmt.targets) {
        if (t !== '') members.push(t);
      }
    } else if (stmt.kind === 'AnnAssign') {
      if (stmt.target !== '') members.push(stmt.target);
    }
  }
  return {
    kind: 'ClassDef',
    range,
    name,
    bases,
    body,
    members,
    decorators,
  };
}

function classifyDecorator(node: Parser.SyntaxNode): Decorator {
  // Decorator's first NAMED child is the inner expression (`Name`,
  // `Attribute`, `Call`, etc.). Anonymous `@` is skipped automatically.
  const inner = node.namedChild(0);
  const expr =
    inner !== null
      ? classifyExpression(inner)
      : ({ kind: 'UnknownExpression', range: rangeOf(node) } satisfies UnknownExpression);
  return {
    kind: 'Decorator',
    range: rangeOf(node),
    expression: expr,
  };
}

function classifyParameters(paramsNode: Parser.SyntaxNode | null): PyParameter[] {
  if (paramsNode === null) return [];
  const out: PyParameter[] = [];
  for (const child of namedChildren(paramsNode)) {
    const range = rangeOf(child);
    switch (child.type) {
      case 'identifier':
        out.push({ name: child.text, kind: 'pos', range });
        break;
      case 'typed_parameter': {
        // The first NAMED child is the binding identifier. (`type` field
        // carries the annotation; we don't surface it in PyParameter.)
        const ident = child.namedChild(0);
        const name = ident !== null && ident.type === 'identifier' ? ident.text : '';
        out.push({ name, kind: 'pos', range });
        break;
      }
      case 'default_parameter':
      case 'typed_default_parameter': {
        const nameField = child.childForFieldName('name');
        const name = nameField !== null ? nameField.text : '';
        out.push({ name, kind: 'pos', range });
        break;
      }
      case 'list_splat_pattern': {
        // `*args` — first named child is the identifier
        const ident = child.namedChild(0);
        const name = ident !== null ? ident.text : '';
        out.push({ name, kind: 'vararg', range });
        break;
      }
      case 'dictionary_splat_pattern': {
        const ident = child.namedChild(0);
        const name = ident !== null ? ident.text : '';
        out.push({ name, kind: 'kwarg', range });
        break;
      }
      case 'positional_separator':
        out.push({ name: '/', kind: 'pos-only', range });
        break;
      case 'keyword_separator':
        // Bare `*` separator
        out.push({ name: '*', kind: 'kw-only', range });
        break;
      default:
        // Pattern parameter or grammar form we don't surface — emit a
        // structural placeholder so downstream code sees a name slot.
        out.push({ name: '', kind: 'pos', range });
    }
  }
  return out;
}

function hasAnonymousChild(node: Parser.SyntaxNode, kind: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child !== null && !child.isNamed && child.type === kind) return true;
  }
  return false;
}

function classifyImport(node: Parser.SyntaxNode, range: Range): ImportStmt {
  // `import_statement` carries its imported modules under the `name` field as
  // either a `dotted_name` or an `aliased_import` whose inner `name` field
  // is a `dotted_name`. We use `childrenForFieldName('name')` to enumerate.
  const names: string[] = [];
  const fieldNodes = node.childrenForFieldName('name');
  for (const f of fieldNodes) {
    if (f.type === 'aliased_import') {
      const inner = f.childForFieldName('name');
      const alias = f.childForFieldName('alias');
      const dotted = inner !== null ? dottedNameText(inner) : '';
      const aliasName = alias !== null ? alias.text : '';
      // We surface the dotted module spec; alias is stored downstream by
      // the visitor (which re-walks the same node).
      names.push(aliasName !== '' ? `${dotted} as ${aliasName}` : dotted);
    } else {
      names.push(dottedNameText(f));
    }
  }
  return { kind: 'ImportStmt', range, names };
}

/**
 * Read a `dotted_name` node back as its source text (`os.path` / `foo.bar`).
 * Falls back to `node.text` for any non-`dotted_name` shape (the grammar
 * sometimes nests under `aliased_import`).
 */
function dottedNameText(node: Parser.SyntaxNode): string {
  if (node.type === 'dotted_name') return node.text;
  return node.text;
}

function classifyImportFrom(node: Parser.SyntaxNode, range: Range): ImportFromStmt {
  // `import_from_statement` has:
  //   - field `module_name` carrying either `dotted_name` or `relative_import`
  //   - one or more field `name` carrying `dotted_name` / `aliased_import`
  //   - or a single `wildcard_import` named child for `from x import *`
  const moduleField = node.childForFieldName('module_name');
  let module: string | null = null;
  let level = 0;
  if (moduleField !== null) {
    if (moduleField.type === 'relative_import') {
      // Children: import_prefix (zero or more `.`s) + optional dotted_name.
      const prefix = moduleField.namedChild(0);
      if (prefix !== null && prefix.type === 'import_prefix') {
        // Each `.` is an anonymous child; count them.
        for (let i = 0; i < prefix.childCount; i++) {
          const c = prefix.child(i);
          if (c !== null && !c.isNamed && c.type === '.') level += 1;
        }
      }
      // Look for the optional dotted_name AFTER the prefix.
      for (let i = 1; i < moduleField.namedChildCount; i++) {
        const child = moduleField.namedChild(i);
        if (child !== null && child.type === 'dotted_name') {
          module = child.text;
          break;
        }
      }
    } else if (moduleField.type === 'dotted_name') {
      module = moduleField.text;
    } else {
      module = moduleField.text;
    }
  }
  // Names: either `wildcard_import` or one or more `dotted_name`/`aliased_import`.
  const names: string[] = [];
  let sawWildcard = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child === null) continue;
    if (child.type === 'wildcard_import') {
      sawWildcard = true;
      break;
    }
  }
  if (sawWildcard) {
    names.push('*');
  } else {
    const nameNodes = node.childrenForFieldName('name');
    for (const f of nameNodes) {
      if (f.type === 'aliased_import') {
        const inner = f.childForFieldName('name');
        const alias = f.childForFieldName('alias');
        const dotted = inner !== null ? dottedNameText(inner) : '';
        const aliasName = alias !== null ? alias.text : '';
        names.push(aliasName !== '' ? `${dotted} as ${aliasName}` : dotted);
      } else {
        names.push(dottedNameText(f));
      }
    }
  }
  return { kind: 'ImportFromStmt', range, module, level, names };
}

function classifyExpressionStmt(node: Parser.SyntaxNode, range: Range): PyStatement {
  // `expression_statement` wraps:
  //   - assignment            → Assign / AnnAssign
  //   - augmented_assignment  → AugAssign
  //   - any expression         → ExpressionStmt (with classified inner expr)
  const inner = node.namedChild(0);
  if (inner === null) {
    const expr: UnknownExpression = { kind: 'UnknownExpression', range };
    const stmt: ExpressionStmt = { kind: 'ExpressionStmt', range, expression: expr };
    return stmt;
  }
  if (inner.type === 'assignment') {
    return classifyAssignment(inner, range);
  }
  if (inner.type === 'augmented_assignment') {
    return classifyAugAssignment(inner, range);
  }
  const expr: ExpressionStmt = {
    kind: 'ExpressionStmt',
    range,
    expression: classifyExpression(inner),
  };
  return expr;
}

function classifyAssignment(node: Parser.SyntaxNode, range: Range): Assign | AnnAssign {
  // `assignment` shape:
  //   - field `left`      : identifier | tuple_pattern | list_pattern | ...
  //   - field `type`      : `type` (annotation expression) — present for `x: T`
  //   - field `right`     : expression — present for `x = 1` / `x: T = 1`
  const leftField = node.childForFieldName('left');
  const typeField = node.childForFieldName('type');
  const rightField = node.childForFieldName('right');
  if (typeField !== null) {
    // Annotated form. Single target name (Python permits `(a, b): int = ...`
    // only in narrow cases — collapse opaque forms to '').
    const target = leftField !== null && leftField.type === 'identifier' ? leftField.text : '';
    const annotation = classifyAnnotation(typeField);
    if (rightField !== null) {
      return {
        kind: 'AnnAssign',
        range,
        target,
        annotation,
        value: classifyExpression(rightField),
      };
    }
    return { kind: 'AnnAssign', range, target, annotation };
  }
  // Plain assignment. Target list collected from `leftField`. Multi-target
  // chains (`a = b = 1`) appear with `right` itself being another assignment;
  // we flatten the chain.
  const targets: string[] = [];
  collectAssignTargets(leftField, targets);
  let value: PyExpression;
  if (rightField !== null) {
    if (rightField.type === 'assignment') {
      // Chained: continue collecting from the inner left, then take the
      // innermost right as the value.
      let cursor: Parser.SyntaxNode | null = rightField;
      while (cursor !== null && cursor.type === 'assignment') {
        const innerLeft = cursor.childForFieldName('left');
        collectAssignTargets(innerLeft, targets);
        cursor = cursor.childForFieldName('right');
      }
      value =
        cursor !== null
          ? classifyExpression(cursor)
          : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
    } else {
      value = classifyExpression(rightField);
    }
  } else {
    value = { kind: 'UnknownExpression', range };
  }
  return { kind: 'Assign', range, targets, value };
}

function collectAssignTargets(node: Parser.SyntaxNode | null, out: string[]): void {
  if (node === null) return;
  if (node.type === 'identifier') {
    out.push(node.text);
    return;
  }
  if (node.type === 'tuple_pattern' || node.type === 'list_pattern') {
    for (const c of namedChildren(node)) {
      collectAssignTargets(c, out);
    }
    return;
  }
  if (node.type === 'list_splat_pattern' || node.type === 'dictionary_splat_pattern') {
    const inner = node.namedChild(0);
    if (inner !== null) collectAssignTargets(inner, out);
    return;
  }
  // Attribute / subscript / pattern — collapse to '' so the visitor sees a
  // slot but skips on emit.
  out.push('');
}

function classifyAnnotation(typeNode: Parser.SyntaxNode): PyExpression {
  // `type` wraps a single inner expression (Name / Subscript / String etc.).
  if (typeNode.type === 'type') {
    const inner = typeNode.namedChild(0);
    return inner !== null
      ? classifyExpression(inner)
      : ({ kind: 'UnknownExpression', range: rangeOf(typeNode) } satisfies UnknownExpression);
  }
  return classifyExpression(typeNode);
}

function classifyAugAssignment(node: Parser.SyntaxNode, range: Range): AugAssign {
  const leftField = node.childForFieldName('left');
  const opField = node.childForFieldName('operator');
  const rightField = node.childForFieldName('right');
  const target = leftField !== null && leftField.type === 'identifier' ? leftField.text : '';
  const op = opField !== null ? opField.text : '';
  const value =
    rightField !== null
      ? classifyExpression(rightField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'AugAssign', range, target, op, value };
}

function classifyIf(node: Parser.SyntaxNode, range: Range): IfStmt {
  // tree-sitter-python lays out `if` as `condition` + `consequence` + zero or
  // more `alternative` (elif_clause | else_clause). For our union we collapse
  // every consequent into `body`.
  const cond = node.childForFieldName('condition');
  const test =
    cond !== null
      ? classifyExpression(cond)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const body: PyStatement[] = [];
  const consequence = node.childForFieldName('consequence');
  body.push(...blockBody(consequence));
  for (const alt of node.childrenForFieldName('alternative')) {
    if (alt.type === 'elif_clause') {
      const altCons = alt.childForFieldName('consequence');
      body.push(...blockBody(altCons));
    } else if (alt.type === 'else_clause') {
      const altBody = alt.childForFieldName('body');
      body.push(...blockBody(altBody));
    }
  }
  return { kind: 'IfStmt', range, test, body };
}

function classifyFor(node: Parser.SyntaxNode, range: Range): ForStmt {
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  const target = left !== null && left.type === 'identifier' ? left.text : '';
  const iter =
    right !== null
      ? classifyExpression(right)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const body: PyStatement[] = [];
  body.push(...blockBody(node.childForFieldName('body')));
  // for/else fold-in
  for (const alt of node.childrenForFieldName('alternative')) {
    if (alt.type === 'else_clause') {
      body.push(...blockBody(alt.childForFieldName('body')));
    }
  }
  return { kind: 'ForStmt', range, target, iter, body };
}

function classifyWhile(node: Parser.SyntaxNode, range: Range): WhileStmt {
  const cond = node.childForFieldName('condition');
  const test =
    cond !== null
      ? classifyExpression(cond)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const body: PyStatement[] = [];
  body.push(...blockBody(node.childForFieldName('body')));
  for (const alt of node.childrenForFieldName('alternative')) {
    if (alt.type === 'else_clause') {
      body.push(...blockBody(alt.childForFieldName('body')));
    }
  }
  return { kind: 'WhileStmt', range, test, body };
}

function classifyTry(node: Parser.SyntaxNode, range: Range): TryStmt {
  const body: PyStatement[] = [];
  const handlers: PyExpression[] = [];
  // The try body is the first `block` named child.
  for (const child of namedChildren(node)) {
    if (child.type === 'block') {
      // The try body's block — only the FIRST one (subsequent blocks belong
      // to except/else/finally clauses, which are separate clause nodes).
      if (body.length === 0) {
        body.push(...blockBody(child));
      }
      continue;
    }
    if (child.type === 'except_clause' || child.type === 'except_group_clause') {
      // First NAMED child of an except_clause (when present and not a `block`)
      // is the exception-type expression — possibly wrapped in `as_pattern`.
      for (let i = 0; i < child.namedChildCount; i++) {
        const sub = child.namedChild(i);
        if (sub === null) continue;
        if (sub.type === 'block') {
          body.push(...blockBody(sub));
        } else if (sub.type === 'as_pattern') {
          // First named child of as_pattern is the exception type.
          const inner = sub.namedChild(0);
          if (inner !== null) handlers.push(classifyExpression(inner));
        } else {
          handlers.push(classifyExpression(sub));
        }
      }
    } else if (child.type === 'else_clause' || child.type === 'finally_clause') {
      const cBody = child.childForFieldName('body');
      if (cBody !== null) {
        body.push(...blockBody(cBody));
      } else {
        // Some grammar forms expose `block` directly as a named child.
        for (const c of namedChildren(child)) {
          if (c.type === 'block') body.push(...blockBody(c));
        }
      }
    }
  }
  return { kind: 'TryStmt', range, body, handlers };
}

function classifyWith(node: Parser.SyntaxNode, range: Range): WithStmt {
  const items: PyExpression[] = [];
  for (const child of namedChildren(node)) {
    if (child.type === 'with_clause') {
      for (const item of namedChildren(child)) {
        if (item.type === 'with_item') {
          const valueField = item.childForFieldName('value');
          if (valueField !== null) {
            // `with x as y` exposes valueField as `as_pattern`; walk into it
            // for the underlying expression.
            if (valueField.type === 'as_pattern') {
              const inner = valueField.namedChild(0);
              if (inner !== null) items.push(classifyExpression(inner));
            } else {
              items.push(classifyExpression(valueField));
            }
          }
        }
      }
    }
  }
  const body = blockBody(node.childForFieldName('body'));
  return { kind: 'WithStmt', range, items, body };
}

function classifyMatch(node: Parser.SyntaxNode, range: Range): MatchStmt {
  const subjField = node.childForFieldName('subject');
  const subject =
    subjField !== null
      ? classifyExpression(subjField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const body: PyStatement[] = [];
  const bodyBlock = node.childForFieldName('body');
  if (bodyBlock !== null) {
    for (const alt of bodyBlock.childrenForFieldName('alternative')) {
      if (alt.type === 'case_clause') {
        const cons = alt.childForFieldName('consequence');
        body.push(...blockBody(cons));
      }
    }
    // Some grammar versions place case_clauses directly as named children of
    // the body block; fall back to scanning.
    if (body.length === 0) {
      for (const child of namedChildren(bodyBlock)) {
        if (child.type === 'case_clause') {
          const cons = child.childForFieldName('consequence');
          body.push(...blockBody(cons));
        }
      }
    }
  }
  return { kind: 'MatchStmt', range, subject, body };
}

function classifyReturn(node: Parser.SyntaxNode, range: Range): ReturnStmt {
  const inner = node.namedChild(0);
  if (inner === null) return { kind: 'ReturnStmt', range };
  return { kind: 'ReturnStmt', range, value: classifyExpression(inner) };
}

function classifyYieldStmt(node: Parser.SyntaxNode, range: Range): YieldStmt {
  // The grammar usually wraps yield expressions in expression_statement.
  // This pathway handles the rare bare `yield_statement` shape.
  const inner = node.namedChild(0);
  if (inner === null) return { kind: 'YieldStmt', range, from: false };
  const isFrom = hasAnonymousChild(inner, 'from');
  const valueNode = inner.namedChild(0);
  if (valueNode !== null) {
    return { kind: 'YieldStmt', range, from: isFrom, value: classifyExpression(valueNode) };
  }
  return { kind: 'YieldStmt', range, from: isFrom };
}

function classifyRaise(node: Parser.SyntaxNode, range: Range): RaiseStmt {
  // First named child = exception (optional); childForFieldName('cause') = cause.
  const cause = node.childForFieldName('cause');
  let exception: PyExpression | undefined;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child === null) continue;
    if (cause !== null && child.id === cause.id) continue;
    exception = classifyExpression(child);
    break;
  }
  if (cause !== null) {
    if (exception !== undefined) {
      return { kind: 'RaiseStmt', range, exception, cause: classifyExpression(cause) };
    }
    return { kind: 'RaiseStmt', range, cause: classifyExpression(cause) };
  }
  if (exception !== undefined) {
    return { kind: 'RaiseStmt', range, exception };
  }
  return { kind: 'RaiseStmt', range };
}

// --------------------------------------------------------------------------
// Expression classifiers
// --------------------------------------------------------------------------

function classifyExpression(node: Parser.SyntaxNode): PyExpression {
  const range = rangeOf(node);
  switch (node.type) {
    case 'identifier': {
      const out: Name = { kind: 'Name', range, id: node.text };
      return out;
    }
    case 'integer':
      return { kind: 'Constant', range, value: parseIntegerLiteral(node.text) };
    case 'float':
      return { kind: 'Constant', range, value: parseFloatLiteral(node.text) };
    case 'true':
      return { kind: 'Constant', range, value: true };
    case 'false':
      return { kind: 'Constant', range, value: false };
    case 'none':
      return { kind: 'Constant', range, value: null };
    case 'string':
      return classifyString(node, range);
    case 'concatenated_string':
      return classifyConcatString(node, range);
    case 'call':
      return classifyCall(node, range);
    case 'attribute':
      return classifyAttribute(node, range);
    case 'subscript':
      return classifySubscript(node, range);
    case 'binary_operator':
    case 'comparison_operator':
      return classifyBinOp(node, range);
    case 'unary_operator':
    case 'not_operator':
      return classifyUnaryOp(node, range);
    case 'boolean_operator':
      return classifyBoolOp(node, range);
    case 'named_expression':
      return classifyWalrus(node, range);
    case 'lambda':
      return classifyLambda(node, range);
    case 'list_comprehension':
      return classifyComprehension(node, range, 'list');
    case 'set_comprehension':
      return classifyComprehension(node, range, 'set');
    case 'dictionary_comprehension':
      return classifyComprehension(node, range, 'dict');
    case 'generator_expression':
      return classifyComprehension(node, range, 'generator');
    case 'tuple':
      return classifyTuple(node, range);
    case 'list':
      return classifyList(node, range);
    case 'dictionary':
      return classifyDict(node, range);
    case 'set':
      return classifySet(node, range);
    case 'list_splat':
    case 'dictionary_splat':
      return classifyStarred(node, range);
    case 'await':
      return classifyAwait(node, range);
    case 'yield':
      return classifyYieldExpr(node, range);
    case 'conditional_expression':
      return classifyConditional(node, range);
    case 'parenthesized_expression': {
      // Unwrap — `(expr)` carries the same semantics as `expr` for our union.
      const inner = node.namedChild(0);
      return inner !== null ? classifyExpression(inner) : { kind: 'UnknownExpression', range };
    }
    case 'expression_list': {
      // `a, b` in expression context — surface as a tuple.
      const elements: PyExpression[] = [];
      for (const child of namedChildren(node)) {
        elements.push(classifyExpression(child));
      }
      const tup: Tuple = { kind: 'Tuple', range, elements };
      return tup;
    }
    default: {
      const fallback: UnknownExpression = { kind: 'UnknownExpression', range };
      return fallback;
    }
  }
}

function classifyCall(node: Parser.SyntaxNode, range: Range): Call {
  const funcField = node.childForFieldName('function');
  const argsField = node.childForFieldName('arguments');
  const func =
    funcField !== null
      ? classifyExpression(funcField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const args: PyExpression[] = [];
  if (argsField !== null) {
    for (const child of namedChildren(argsField)) {
      // keyword_argument → unwrap to the value side; the binding is opaque.
      if (child.type === 'keyword_argument') {
        const valueField = child.childForFieldName('value');
        args.push(
          valueField !== null
            ? classifyExpression(valueField)
            : { kind: 'UnknownExpression', range: rangeOf(child) },
        );
      } else {
        args.push(classifyExpression(child));
      }
    }
  }
  return { kind: 'Call', range, func, args };
}

function classifyAttribute(node: Parser.SyntaxNode, range: Range): Attribute {
  const objField = node.childForFieldName('object');
  const attrField = node.childForFieldName('attribute');
  const value =
    objField !== null
      ? classifyExpression(objField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const attr = attrField !== null ? attrField.text : '';
  return { kind: 'Attribute', range, value, attr };
}

function classifySubscript(node: Parser.SyntaxNode, range: Range): Subscript {
  const valueField = node.childForFieldName('value');
  const sliceField = node.childForFieldName('subscript');
  const value =
    valueField !== null
      ? classifyExpression(valueField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const slice =
    sliceField !== null
      ? classifyExpression(sliceField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'Subscript', range, value, slice };
}

function classifyBinOp(node: Parser.SyntaxNode, range: Range): BinOp {
  const leftField = node.childForFieldName('left');
  const opField = node.childForFieldName('operator');
  const rightField = node.childForFieldName('right');
  const left =
    leftField !== null
      ? classifyExpression(leftField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const right =
    rightField !== null
      ? classifyExpression(rightField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  let op = opField !== null ? opField.text : '';
  if (op === '' && node.type === 'comparison_operator') {
    // Comparison nodes expose the operator under the `operators` field
    // (plural — chained comparisons). Take the first.
    const opsList = node.childrenForFieldName('operators');
    op = opsList.length > 0 && opsList[0] !== undefined ? opsList[0].text : '';
  }
  return { kind: 'BinOp', range, op, left, right };
}

function classifyUnaryOp(node: Parser.SyntaxNode, range: Range): UnaryOp {
  if (node.type === 'not_operator') {
    const argField = node.childForFieldName('argument');
    const operand =
      argField !== null
        ? classifyExpression(argField)
        : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
    return { kind: 'UnaryOp', range, op: 'not', operand };
  }
  const opField = node.childForFieldName('operator');
  const argField = node.childForFieldName('argument');
  const operand =
    argField !== null
      ? classifyExpression(argField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'UnaryOp', range, op: opField !== null ? opField.text : '', operand };
}

function classifyBoolOp(node: Parser.SyntaxNode, range: Range): BoolOp {
  const opField = node.childForFieldName('operator');
  const opText = opField !== null ? opField.text : 'and';
  const op: 'and' | 'or' = opText === 'or' ? 'or' : 'and';
  // Flatten chained boolean_operator nodes with the same operator into a
  // single BoolOp.values[].
  const values: PyExpression[] = [];
  flattenBoolOp(node, op, values);
  return { kind: 'BoolOp', range, op, values };
}

function flattenBoolOp(node: Parser.SyntaxNode, outerOp: 'and' | 'or', out: PyExpression[]): void {
  if (node.type !== 'boolean_operator') {
    out.push(classifyExpression(node));
    return;
  }
  const opField = node.childForFieldName('operator');
  const op = opField !== null && opField.text === 'or' ? 'or' : 'and';
  if (op !== outerOp) {
    out.push(classifyExpression(node));
    return;
  }
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (left !== null) flattenBoolOp(left, outerOp, out);
  if (right !== null) flattenBoolOp(right, outerOp, out);
}

function classifyWalrus(node: Parser.SyntaxNode, range: Range): Walrus {
  const nameField = node.childForFieldName('name');
  const valueField = node.childForFieldName('value');
  const target = nameField !== null ? nameField.text : '';
  const value =
    valueField !== null
      ? classifyExpression(valueField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'Walrus', range, target, value };
}

function classifyLambda(node: Parser.SyntaxNode, range: Range): Lambda {
  const paramsField = node.childForFieldName('parameters');
  const bodyField = node.childForFieldName('body');
  const params = paramsField !== null ? classifyParameters(paramsField) : [];
  const body =
    bodyField !== null
      ? classifyExpression(bodyField)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'Lambda', range, params, body };
}

function classifyComprehension(
  node: Parser.SyntaxNode,
  range: Range,
  compKind: 'list' | 'set' | 'dict' | 'generator',
): Comprehension {
  // Body of the comprehension: the `body` field plus every `for_in_clause`
  // and `if_clause` walked by the visitor for usage tracking.
  const body: PyExpression[] = [];
  const bodyField = node.childForFieldName('body');
  if (bodyField !== null) {
    if (bodyField.type === 'pair') {
      // Dict comprehension key/value pair — surface both halves.
      const keyField = bodyField.childForFieldName('key');
      const valueField = bodyField.childForFieldName('value');
      if (keyField !== null) body.push(classifyExpression(keyField));
      if (valueField !== null) body.push(classifyExpression(valueField));
    } else {
      body.push(classifyExpression(bodyField));
    }
  }
  for (const child of namedChildren(node)) {
    if (child.type === 'for_in_clause') {
      const right = child.childForFieldName('right');
      if (right !== null) body.push(classifyExpression(right));
    } else if (child.type === 'if_clause') {
      const inner = child.namedChild(0);
      if (inner !== null) body.push(classifyExpression(inner));
    }
  }
  return { kind: 'Comprehension', range, compKind, body };
}

function classifyTuple(node: Parser.SyntaxNode, range: Range): Tuple {
  const elements: PyExpression[] = [];
  for (const child of namedChildren(node)) {
    elements.push(classifyExpression(child));
  }
  return { kind: 'Tuple', range, elements };
}

function classifyList(node: Parser.SyntaxNode, range: Range): List {
  const elements: PyExpression[] = [];
  for (const child of namedChildren(node)) {
    elements.push(classifyExpression(child));
  }
  return { kind: 'List', range, elements };
}

function classifySet(node: Parser.SyntaxNode, range: Range): PySet {
  const elements: PyExpression[] = [];
  for (const child of namedChildren(node)) {
    elements.push(classifyExpression(child));
  }
  return { kind: 'Set', range, elements };
}

function classifyDict(node: Parser.SyntaxNode, range: Range): Dict {
  const entries: DictEntry[] = [];
  for (const child of namedChildren(node)) {
    if (child.type === 'pair') {
      const keyField = child.childForFieldName('key');
      const valueField = child.childForFieldName('value');
      const value =
        valueField !== null
          ? classifyExpression(valueField)
          : ({ kind: 'UnknownExpression', range: rangeOf(child) } satisfies UnknownExpression);
      const entry: DictEntry =
        keyField !== null
          ? { key: classifyExpression(keyField), value, range: rangeOf(child) }
          : { value, range: rangeOf(child) };
      entries.push(entry);
    } else if (child.type === 'dictionary_splat') {
      // `**other` entry with no key — surface as keyless DictEntry whose
      // value is the inner expression.
      const inner = child.namedChild(0);
      const value =
        inner !== null
          ? classifyExpression(inner)
          : ({ kind: 'UnknownExpression', range: rangeOf(child) } satisfies UnknownExpression);
      entries.push({ value, range: rangeOf(child) });
    }
  }
  return { kind: 'Dict', range, entries };
}

function classifyStarred(node: Parser.SyntaxNode, range: Range): Starred {
  const inner = node.namedChild(0);
  const value =
    inner !== null
      ? classifyExpression(inner)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'Starred', range, value };
}

function classifyAwait(node: Parser.SyntaxNode, range: Range): Await {
  const inner = node.namedChild(0);
  const value =
    inner !== null
      ? classifyExpression(inner)
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'Await', range, value };
}

function classifyYieldExpr(node: Parser.SyntaxNode, range: Range): Yield {
  const isFrom = hasAnonymousChild(node, 'from');
  const inner = node.namedChild(0);
  if (inner !== null) {
    return { kind: 'Yield', range, from: isFrom, value: classifyExpression(inner) };
  }
  return { kind: 'Yield', range, from: isFrom };
}

function classifyConditional(node: Parser.SyntaxNode, range: Range): Conditional {
  // tree-sitter-python lays this out positionally: child(0)=consequent,
  // child(1)=test, child(2)=alternate. Use named-child iteration.
  const named = namedChildren(node);
  const cons =
    named[0] !== undefined
      ? classifyExpression(named[0])
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const test =
    named[1] !== undefined
      ? classifyExpression(named[1])
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  const alt =
    named[2] !== undefined
      ? classifyExpression(named[2])
      : ({ kind: 'UnknownExpression', range } satisfies UnknownExpression);
  return { kind: 'Conditional', range, test, consequent: cons, alternate: alt };
}

function classifyString(node: Parser.SyntaxNode, range: Range): Constant | FString {
  // f-strings are the only `string` nodes containing `interpolation` children.
  // Plain / raw / byte strings collapse to a Constant whose value is the
  // verbatim string-content text concatenated (a single `string_content`
  // child in the common case).
  let isFString = false;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child !== null && child.type === 'interpolation') {
      isFString = true;
      break;
    }
  }
  if (isFString) {
    const quasis: string[] = [];
    const parts: PyExpression[] = [];
    let buffer = '';
    let started = false;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child === null) continue;
      if (child.type === 'string_start' || child.type === 'string_end') continue;
      if (child.type === 'string_content') {
        buffer += child.text;
        started = true;
      } else if (child.type === 'interpolation') {
        if (!started) {
          // Leading interpolation with no preceding text — emit empty quasi
          quasis.push('');
        } else {
          quasis.push(buffer);
        }
        buffer = '';
        started = true;
        const expr = child.childForFieldName('expression');
        parts.push(
          expr !== null
            ? classifyExpression(expr)
            : { kind: 'UnknownExpression', range: rangeOf(child) },
        );
      } else if (child.type === 'escape_sequence') {
        buffer += child.text;
        started = true;
      }
    }
    quasis.push(buffer);
    // Invariant: quasis.length === parts.length + 1 when there's at least
    // one interpolation. For zero interpolations isFString would be false.
    return { kind: 'FString', range, quasis, parts };
  }
  // Plain string — collect string_content text. Strip the surrounding quote
  // characters by relying on string_content children rather than node.text.
  let value = '';
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child === null) continue;
    if (child.type === 'string_content') {
      value += child.text;
    } else if (child.type === 'escape_sequence') {
      value += child.text;
    }
  }
  return { kind: 'Constant', range, value };
}

function classifyConcatString(node: Parser.SyntaxNode, range: Range): PyExpression {
  // Adjacent string literals (`"a" "b"`) — concatenate the inner strings if
  // all are plain Constants; otherwise surface as UnknownExpression so the
  // visitor can still walk inner parts when relevant.
  const parts: PyExpression[] = [];
  for (const child of namedChildren(node)) {
    parts.push(classifyExpression(child));
  }
  if (parts.every((p) => p.kind === 'Constant' && typeof p.value === 'string')) {
    let combined = '';
    for (const p of parts) {
      if (p.kind === 'Constant' && typeof p.value === 'string') combined += p.value;
    }
    return { kind: 'Constant', range, value: combined };
  }
  // Fall back to a Tuple-like surface so the walker descends into inner
  // f-string parts.
  return { kind: 'Tuple', range, elements: parts };
}

function parseIntegerLiteral(text: string): number {
  // Strip Python integer suffixes / separators. `_` is a permitted digit
  // separator (PEP 515); `0x`, `0o`, `0b` are base prefixes. Arbitrarily
  // large integers collapse to JS `Infinity` rather than BigInt — the
  // discriminated union narrows `Constant.value` to `number | string |
  // boolean | null` at present (BigInt support is a future-wave call).
  const stripped = text.replace(/_/g, '');
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloatLiteral(text: string): number {
  const stripped = text.replace(/_/g, '');
  const parsed = Number.parseFloat(stripped);
  return Number.isFinite(parsed) ? parsed : 0;
}

// --------------------------------------------------------------------------
// Error translation
// --------------------------------------------------------------------------

interface TreeSitterParseError {
  readonly byteOffset: number;
  readonly endByteOffset: number;
  readonly row: number;
  readonly column: number;
  readonly kind: 'error' | 'missing';
  readonly type: string;
}

function translateError(e: TreeSitterParseError, filename: string, source: string): ParseError {
  const text = e.kind === 'error' ? sliceUtf8(source, e.byteOffset, e.endByteOffset) : e.type;
  const message =
    e.kind === 'error' ? `parse-error: unexpected '${text}'` : `missing token: ${e.type}`;
  return {
    file: filename,
    position: pointToPosition(e.byteOffset, e.row, e.column),
    message,
    code: 'PARSE_SYNTAX_ERROR',
  };
}

/**
 * Best-effort byte-range slice for diagnostic text. tree-sitter byte indices
 * are UTF-8; JS strings are UTF-16. For diagnostic rendering only — accuracy
 * for non-ASCII spans is acceptable to within a few code units.
 */
function sliceUtf8(source: string, startByte: number, endByte: number): string {
  // Walk the source once mapping JS-string indices to UTF-8 byte counts.
  let charIdx = 0;
  let byteIdx = 0;
  let startChar = -1;
  let endChar = -1;
  while (charIdx < source.length && byteIdx <= endByte) {
    if (startChar === -1 && byteIdx >= startByte) startChar = charIdx;
    if (byteIdx >= endByte) {
      endChar = charIdx;
      break;
    }
    const code = source.charCodeAt(charIdx);
    if (code < 0x80) {
      byteIdx += 1;
      charIdx += 1;
    } else if (code < 0x800) {
      byteIdx += 2;
      charIdx += 1;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      byteIdx += 4;
      charIdx += 2;
    } else {
      byteIdx += 3;
      charIdx += 1;
    }
  }
  if (startChar === -1) startChar = source.length;
  if (endChar === -1) endChar = source.length;
  return source.slice(startChar, endChar);
}
