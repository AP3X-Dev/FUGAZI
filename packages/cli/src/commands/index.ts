/**
 * commands/index.ts — Phase 3h.2 — barrel registering all 17 subcommands.
 *
 * The exported `ALL_COMMANDS` array is the canonical list passed to
 * `Cli.from(...)` in `../cli.ts`. Order in this file is alphabetical (the same
 * order `--help` displays). Adding a new subcommand requires (a) shipping the
 * file, (b) re-exporting the class here.
 */
import { AuditCommand } from './audit.js';
import { BoundariesCommand } from './boundaries.js';
import { CircularDepsCommand } from './circular-deps.js';
import { CoverageSetupCommand } from './coverage-setup.js';
import { DeadCodeCommand } from './dead-code.js';
import { DupesCommand } from './dupes.js';
import { ExplainCommand } from './explain.js';
import { FixCommand } from './fix.js';
import { HealthCommand } from './health.js';
import { InitCommand } from './init.js';
import { SchemaCommand } from './schema.js';
import { TraceCommand } from './trace.js';
import { UnusedDepsCommand } from './unused-deps.js';
import { UnusedExportsCommand } from './unused-exports.js';
import { UnusedFilesCommand } from './unused-files.js';
import { UnusedTypesCommand } from './unused-types.js';
import { WatchCommand } from './watch.js';

export {
  AuditCommand,
  BoundariesCommand,
  CircularDepsCommand,
  CoverageSetupCommand,
  DeadCodeCommand,
  DupesCommand,
  ExplainCommand,
  FixCommand,
  HealthCommand,
  InitCommand,
  SchemaCommand,
  TraceCommand,
  UnusedDepsCommand,
  UnusedExportsCommand,
  UnusedFilesCommand,
  UnusedTypesCommand,
  WatchCommand,
};

/** Alphabetical command registry. Drives `--help` output and `Cli.from`. */
export const ALL_COMMANDS = [
  AuditCommand,
  BoundariesCommand,
  CircularDepsCommand,
  CoverageSetupCommand,
  DeadCodeCommand,
  DupesCommand,
  ExplainCommand,
  FixCommand,
  HealthCommand,
  InitCommand,
  SchemaCommand,
  TraceCommand,
  UnusedDepsCommand,
  UnusedExportsCommand,
  UnusedFilesCommand,
  UnusedTypesCommand,
  WatchCommand,
] as const;
