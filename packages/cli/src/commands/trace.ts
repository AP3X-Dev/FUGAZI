/**
 * commands/trace.ts — Phase 3h.2 (T188) — `fugazi trace`.
 *
 * Walks the reverse-import index from `@fugazi/graph` to print the chain of
 * importers reaching a target file (`--file`). The chain is the BFS reverse
 * fan-out from the target to every reachable source — equivalent to "who
 * imports this, transitively". Output is one path per line, lex-sorted, plus
 * a leading anchor line for context. `--export` filters at the resolution
 * layer: only importers whose import statement names that export contribute.
 *
 * Determinism (NFR-1 / SC-15): the BFS visits FileIds in ascending order via
 * `buildReverseIndices`'s sorted Sets, and the output is sort-finalised before
 * write, so byte-equal across runs.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { type Inventory, buildInventory, parse } from '@fugazi/extract';
import { type FileId, type FileNode, buildGraph, buildReverseIndices } from '@fugazi/graph';
import { assignFileIds } from '@fugazi/types';
import { Command, Option } from 'clipanion';

const RECOGNIZED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo']);

export class TraceCommand extends Command {
  static override paths = [['trace']];
  static override usage = {
    description: 'Print the reverse-import chain reaching a file (or named export)',
  };

  file = Option.String('--file', {
    description: 'Target file path (relative to cwd or absolute)',
  });

  exportName = Option.String('--export', {
    description: 'Filter importers to those whose import statement source mentions this name',
  });

  override async execute(): Promise<number> {
    const projectRoot = process.cwd();
    if (this.file === undefined) {
      this.context.stderr.write('fugazi trace: --file <path> is required\n');
      return 2;
    }
    const targetAbs = toPosix(isAbsolute(this.file) ? this.file : join(projectRoot, this.file));
    const files = await discoverFiles(projectRoot);
    if (!files.includes(targetAbs)) {
      this.context.stderr.write(`fugazi trace: target file not in project: ${targetAbs}\n`);
      return 2;
    }

    // Build inventories + graph to resolve the reverse index.
    const ids = assignFileIds(files);
    const fileNodes: FileNode[] = [];
    for (const path of files) {
      const id = ids.get(path);
      if (id === undefined) continue;
      const inventory = await extractInventory(path);
      fileNodes.push({ id, path, inventory });
    }
    const graph = buildGraph({ files: fileNodes, resolverContext: { projectRoot } });
    const reverse = buildReverseIndices(graph);

    const targetId = ids.get(targetAbs);
    if (targetId === undefined) {
      this.context.stderr.write(`fugazi trace: target file not assigned an id: ${targetAbs}\n`);
      return 2;
    }

    // BFS over reverse edges. When --export is set, only edges whose specifier
    // resolves to the target AND mentions the export name in the source file's
    // inventory imports propagate. For 3h.2 we filter purely on existence of
    // the named import in the source file's inventory.
    const reachable = new Set<string>();
    const queue: FileId[] = [targetId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      const incoming = reverse.edgesByTarget.get(current);
      if (incoming === undefined) continue;
      for (const edge of incoming) {
        const sourceNode = graph.files.get(edge.from);
        if (sourceNode === undefined) continue;
        if (this.exportName !== undefined) {
          if (!importsNamed(sourceNode.inventory, this.exportName)) continue;
        }
        if (reachable.has(sourceNode.path)) continue;
        reachable.add(sourceNode.path);
        queue.push(edge.from);
      }
    }

    const sorted = [...reachable].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    this.context.stdout.write(`# importers of ${targetAbs}\n`);
    if (this.exportName !== undefined) {
      this.context.stdout.write(`# filtered by export: ${this.exportName}\n`);
    }
    if (sorted.length === 0) {
      this.context.stdout.write('(none)\n');
      return 0;
    }
    for (const path of sorted) {
      this.context.stdout.write(`${path}\n`);
    }
    return 0;
  }
}

/**
 * In Phase 3h.2 the visitor `Import` carries only the source string, not the
 * named-specifier list. As a usable proxy we accept any importer whose
 * `usages` collection contains an identifier matching `name` — i.e. the
 * binding shows up somewhere in the source file. A future visitor expansion
 * can replace this with a precise specifier-equality check.
 */
function importsNamed(inventory: Inventory, name: string): boolean {
  for (const usage of inventory.usages) {
    if (usage.name === name) return true;
  }
  return false;
}

async function extractInventory(path: string): Promise<Inventory> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    return emptyInventory();
  }
  let result: Awaited<ReturnType<typeof parse>>;
  try {
    result = await parse(source, { filename: path, lang: langForExtension(path) });
  } catch {
    return emptyInventory();
  }
  if (result.program === null) return emptyInventory();
  return buildInventory(result.program);
}

function emptyInventory(): Inventory {
  return Object.freeze({
    declarations: Object.freeze([]),
    imports: Object.freeze([]),
    usages: Object.freeze([]),
  });
}

function toPosix(p: string): string {
  return sep === '\\' ? p.replaceAll('\\', '/') : p;
}

function langForExtension(path: string): 'ts' | 'tsx' | 'js' | 'jsx' {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) return 'ts';
  return 'js';
}

async function discoverFiles(projectRoot: string): Promise<readonly string[]> {
  const out: string[] = [];
  await walkDir(projectRoot, out);
  return out
    .map((p) => toPosix(p))
    .filter((p) => existsSync(p))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function walkDir(dir: string, out: string[]): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot === -1) continue;
      const ext = entry.name.slice(dot);
      if (RECOGNIZED_EXTENSIONS.includes(ext)) out.push(full);
    }
  }
}
