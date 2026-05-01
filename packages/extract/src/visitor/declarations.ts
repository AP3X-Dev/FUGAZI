/**
 * declarations.ts — visitor handler for declaration-shaped nodes.
 *
 * Recognises `FunctionDecl`, `ClassDecl`, `VariableDecl`, `TypeDecl`, and
 * `EnumDecl`, appending a `Declaration` record to the orchestrator's
 * accumulator. The `exported` flag is set when the parent node is an
 * `ExportDecl` (the parser populates `ExportDecl.declaration` for forms like
 * `export const x = 1` / `export function f() {}` / `export default function g() {}`).
 *
 * Class members and enum members are flattened to the declared names in
 * declaration order. Variable declarators expand into ONE `Declaration` per
 * declarator name (destructuring patterns whose binding name is the empty
 * string are skipped — the parser collapses them to '').
 */

import type {
  ASTNode,
  ClassDecl,
  EnumDecl,
  FunctionDecl,
  TypeDecl,
  VariableDecl,
} from '../ast/kinds.js';
import type { Declaration } from './types.js';

export function handleFunction(
  node: FunctionDecl,
  parent: ASTNode | null,
  out: Declaration[],
): void {
  if (node.name === null || node.name === '') return;
  out.push({
    kind: 'function',
    name: node.name,
    exported: parent !== null && parent.kind === 'ExportDecl',
    range: node.range,
    members: [],
  });
}

export function handleClass(node: ClassDecl, parent: ASTNode | null, out: Declaration[]): void {
  if (node.name === null || node.name === '') return;
  const members = node.members.map((m) => m.name).filter((n) => n !== '');
  out.push({
    kind: 'class',
    name: node.name,
    exported: parent !== null && parent.kind === 'ExportDecl',
    range: node.range,
    members,
  });
}

export function handleVariable(
  node: VariableDecl,
  parent: ASTNode | null,
  out: Declaration[],
): void {
  const exported = parent !== null && parent.kind === 'ExportDecl';
  for (const declarator of node.declarations) {
    if (declarator.name === '') continue;
    out.push({
      kind: 'variable',
      name: declarator.name,
      exported,
      range: declarator.range,
      members: [],
    });
  }
}

export function handleType(node: TypeDecl, parent: ASTNode | null, out: Declaration[]): void {
  if (node.name === '') return;
  out.push({
    kind: 'type',
    name: node.name,
    exported: parent !== null && parent.kind === 'ExportDecl',
    range: node.range,
    members: [],
  });
}

export function handleEnum(node: EnumDecl, parent: ASTNode | null, out: Declaration[]): void {
  if (node.name === '') return;
  const members = node.members.map((m) => m.name).filter((n) => n !== '');
  out.push({
    kind: 'enum',
    name: node.name,
    exported: parent !== null && parent.kind === 'ExportDecl',
    range: node.range,
    members,
  });
}
