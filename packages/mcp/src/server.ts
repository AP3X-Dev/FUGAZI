/**
 * server.ts — Phase 3h.4 (T198) — MCP server boot.
 *
 * Boots an `@modelcontextprotocol/sdk` `Server` over stdio. Two request
 * handlers are wired:
 *
 *   - `tools/list`   — emits the closed 15-tool advertise list.
 *   - `tools/call`   — dispatches to the named tool, parsing arguments via
 *                      the tool's Zod schema (validation envelope on failure).
 *
 * Per D1 the server runs in-process: every tool body imports `runAnalysis`
 * (or a node-api wrapper around it) directly. No subprocess exec is allowed
 * anywhere in this package — verified by the no-subprocess source-grep gate.
 *
 * The tool result is JSON-stringified into a single MCP `text` content block
 * with the structured payload also surfaced via the `structuredContent` field
 * so callers parsing JSON receive the deeply-typed envelope.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ALL_TOOLS, verifyRegistry } from './tools/index.js';
import type { AnyTool, ToolResult } from './types.js';
import { withValidation } from './validate.js';

const SERVER_INFO = Object.freeze({ name: 'fugazi', version: '0.0.0' });

/** Build the JSON Schema for a tool's input. Always emits an object schema. */
function inputSchemaFor(tool: AnyTool): Tool['inputSchema'] {
  const json = z.toJSONSchema(tool.schema);
  if (
    typeof json === 'object' &&
    json !== null &&
    'type' in json &&
    (json as { type?: unknown }).type === 'object'
  ) {
    return json as Tool['inputSchema'];
  }
  // Fallback — wrap a non-object schema (unlikely; every tool uses z.object)
  // so the `tools/list` advertise contract holds.
  return { type: 'object' };
}

/**
 * Construct the registry payload + dispatcher used by both the in-process
 * server boot and the test harness.
 */
export interface RegistryHandle {
  readonly listTools: () => ListToolsResult;
  readonly callTool: (name: string, args: unknown) => Promise<CallToolResult>;
  /** Underlying tool defs, keyed by name. */
  readonly tools: ReadonlyMap<string, AnyTool>;
}

export function buildRegistry(tools: readonly AnyTool[] = ALL_TOOLS): RegistryHandle {
  verifyRegistry(tools);
  const byName = new Map<string, AnyTool>();
  for (const tool of tools) byName.set(tool.name, tool);

  const listing: readonly Tool[] = Object.freeze(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: inputSchemaFor(tool),
      annotations: { readOnlyHint: tool.mode === 'read' },
    })),
  );

  async function callTool(name: string, args: unknown): Promise<CallToolResult> {
    const tool = byName.get(name);
    if (tool === undefined) {
      const text = JSON.stringify({
        error: true,
        message: `Unknown tool: ${name}`,
        exit_code: 0,
      });
      return {
        isError: true,
        content: [{ type: 'text', text }],
      };
    }
    const wrapped = withValidation(tool.schema, tool.handler);
    const result = (await wrapped(args)) as ToolResult<unknown>;
    return {
      isError: result.error === true,
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  }

  return {
    listTools: () => ({ tools: listing as Tool[] }),
    callTool,
    tools: byName,
  };
}

/**
 * Boot the MCP server over stdio. Exposed via the package barrel as `start`.
 */
export async function startServer(): Promise<void> {
  const registry = buildRegistry();
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => registry.listTools());
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    registry.callTool(request.params.name, request.params.arguments),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
