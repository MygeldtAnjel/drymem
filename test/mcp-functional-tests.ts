#!/usr/bin/env tsx
/// <reference types="node" />
/**
 * Functional tests for all drymem MCP tools.
 * Spawns the MCP server over stdio and communicates via JSON-RPC.
 *
 * Test data is created inside the tests themselves via mem_finalize_session,
 * which acts as the fixture setup for the read/delete tests that follow.
 * A unique project_path per run keeps test data isolated from production.
 *
 * Usage: node_modules/.bin/tsx test/mcp-functional-tests.ts
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface }          from 'node:readline';
import { fileURLToPath }            from 'node:url';
import { dirname, resolve }         from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, '..');
const TSX_PATH     = resolve(PROJECT_ROOT, 'node_modules/tsx/dist/cli.mjs');
const SERVER_PATH  = resolve(PROJECT_ROOT, 'src/delivery/mcp/server.ts');

const RUN_ID         = Date.now();
const TEST_PROJECT   = `/tmp/drymem-functional-test-${RUN_ID}`;
const TEST_TOPIC_KEY = `test/functional-${RUN_ID}`;

// ─── types ────────────────────────────────────────────────────────────────────

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?:     number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?:  { code: number; message: string };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject:  (reason: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

interface ToolResult {
  content:  Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface Memory {
  topic_key:  string;
  content:    string;
  status:     string;
  updated_at: string;
}

interface ListToolsResult {
  tools: Array<{ name: string; description?: string }>;
}

// ─── assertion helper ─────────────────────────────────────────────────────────

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ─── MCP client ──────────────────────────────────────────────────────────────

class MCPClient {
  private _proc:    ChildProcess | null          = null;
  private _pending: Map<number, PendingRequest>  = new Map();
  private _nextId:  number                       = 1;

  async start(): Promise<void> {
    this._proc = spawn('/usr/bin/node', [TSX_PATH, SERVER_PATH], {
      cwd:   PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this._proc.on('error', (err: Error) => {
      throw new Error(`Server process error: ${err.message}`);
    });

    const rl = createInterface({ input: this._proc.stdout! });
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: JsonRpcMessage;
      try { msg = JSON.parse(trimmed) as JsonRpcMessage; } catch { return; }

      const id = msg.id;
      if (id == null) return;
      const pending = this._pending.get(id);
      if (pending == null) return;

      this._pending.delete(id);
      clearTimeout(pending.timer);

      if (msg.error != null) {
        pending.reject(new Error(`RPC error ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
    });

    // MCP handshake
    await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:      { name: 'mcp-functional-tests', version: '1.0.0' },
    });
    this._send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    // Allow migrations + FTS init to complete
    await sleep(300);
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this._request('tools/call', { name, arguments: args }) as Promise<ToolResult>;
  }

  listTools(): Promise<ListToolsResult> {
    return this._request('tools/list', {}) as Promise<ListToolsResult>;
  }

  stop(): void {
    this._proc?.stdin?.end();
    this._proc?.kill('SIGTERM');
  }

  private _request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id    = this._nextId++;
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} (id=${id})`));
      }, 15_000);
      this._pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private _send(msg: JsonRpcMessage): void {
    this._proc?.stdin?.write(JSON.stringify(msg) + '\n');
  }
}

// ─── test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${(err as Error).message}`);
    failed++;
  }
}

function text(result: ToolResult): string {
  return result?.content?.[0]?.text ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('drymem MCP Functional Tests');
  console.log(`  project path : ${TEST_PROJECT}`);
  console.log(`  topic key    : ${TEST_TOPIC_KEY}\n`);

  const client = new MCPClient();

  try {
    await client.start();
    console.log('Server ready.\n');

    // ── tools/list ──────────────────────────────────────────────────────────
    console.log('tools/list');

    await test('exposes all 4 required tools', async () => {
      const result = await client.listTools();
      const names  = result.tools.map(t => t.name);
      for (const expected of ['mem_context', 'mem_search', 'mem_delete', 'mem_finalize_session']) {
        assert(names.includes(expected), `Missing tool: ${expected}`);
      }
    });

    // ── mem_finalize_session ─────────────────────────────────────────────────
    // These tests also seed the dummy data that subsequent read/delete tests use.
    console.log('\nmem_finalize_session');

    await test('saves a new session memory', async () => {
      const result = await client.callTool('mem_finalize_session', {
        topic_key:         TEST_TOPIC_KEY,
        project_path:      TEST_PROJECT,
        problem_statement: 'Test problem: wire up MCP functional tests over stdio',
        solution_summary:  'Spawn server, exchange JSON-RPC, assert tool responses',
        affected_files:    'test/mcp-functional-tests.ts',
        key_learnings:     'MCP stdio transport uses newline-delimited JSON (no Content-Length headers)',
      });
      const t = text(result);
      assert(t.includes('finalized') && t.includes(TEST_TOPIC_KEY),
        `Expected success confirmation, got: "${t}"`);
    });

    await test('upserts (overwrites) an existing memory on the same topic_key', async () => {
      const result = await client.callTool('mem_finalize_session', {
        topic_key:         TEST_TOPIC_KEY,
        project_path:      TEST_PROJECT,
        problem_statement: 'Upsert check: second write to same topic_key',
        solution_summary:  'ON CONFLICT upsert clears deleted_at and bumps revision_count',
        affected_files:    'src/infrastructure/database/memory-repository.ts',
        key_learnings:     'revision_count increments on every upsert',
      });
      const t = text(result);
      assert(t.includes('finalized'),
        `Expected success on upsert, got: "${t}"`);
    });

    // ── mem_context ──────────────────────────────────────────────────────────
    console.log('\nmem_context');

    await test('returns the saved memory for the test project', async () => {
      const result   = await client.callTool('mem_context', { project_path: TEST_PROJECT });
      const t        = text(result);
      assert(t !== 'No recent context.', `Expected memories, got "No recent context."`);
      const memories = JSON.parse(t) as Memory[];
      assert(memories.length > 0, 'Expected a non-empty array');
      const match = memories.find(m => m.topic_key === TEST_TOPIC_KEY);
      assert(match != null, `topic_key "${TEST_TOPIC_KEY}" not found in context`);
      assert(match.content.includes('Upsert check'), 'Content should reflect the upserted version');
    });

    await test('returns "No recent context." for an unknown project path', async () => {
      const result = await client.callTool('mem_context', {
        project_path: '/tmp/drymem-nonexistent-project-zzzxxx',
      });
      const t = text(result);
      assert(t === 'No recent context.', `Expected "No recent context.", got: "${t}"`);
    });

    // ── mem_search ───────────────────────────────────────────────────────────
    console.log('\nmem_search');

    await test('finds the memory by a keyword present in its content', async () => {
      const result   = await client.callTool('mem_search', {
        keyword:      'Upsert check',
        project_path: TEST_PROJECT,
      });
      const t = text(result);
      assert(t !== 'No memories found.', `Expected results, got "No memories found."`);
      const memories = JSON.parse(t) as Memory[];
      const match    = memories.find(m => m.topic_key === TEST_TOPIC_KEY);
      assert(match != null, `topic_key "${TEST_TOPIC_KEY}" not found in search results`);
    });

    await test('finds the memory by a plain-word keyword from its topic_key', async () => {
      // Use only the alphabetic segment – FTS5 treats a bare hyphen as NOT,
      // which throws "no such column: <number>" and silently swallows the LIKE
      // fallback. "functional" is safe, unique within the test scope, and also
      // embedded in the markdown summary that mem_finalize_session generates.
      const keyword = 'functional';
      const result  = await client.callTool('mem_search', {
        keyword,
        project_path: TEST_PROJECT,
      });
      const t = text(result);
      assert(t !== 'No memories found.',
        `Expected results for keyword "${keyword}", got "No memories found."`);
      const memories = JSON.parse(t) as Memory[];
      const match    = memories.find(m => m.topic_key === TEST_TOPIC_KEY);
      assert(match != null, `topic_key "${TEST_TOPIC_KEY}" not found when searching "${keyword}"`);
    });

    await test('returns "No memories found." for an unmatched keyword', async () => {
      const result = await client.callTool('mem_search', {
        keyword:      'zzzzz-guaranteed-nonexistent-xyzzy-99999',
        project_path: TEST_PROJECT,
      });
      const t = text(result);
      assert(t === 'No memories found.',
        `Expected "No memories found.", got: "${t}"`);
    });

    // ── mem_delete ───────────────────────────────────────────────────────────
    console.log('\nmem_delete');

    await test('soft-deletes the existing test memory', async () => {
      const result = await client.callTool('mem_delete', {
        topic_key:    TEST_TOPIC_KEY,
        project_path: TEST_PROJECT,
      });
      const t = text(result);
      assert(t.includes('deleted') && t.includes(TEST_TOPIC_KEY),
        `Expected deletion confirmation, got: "${t}"`);
    });

    await test('returns "Memory not found." for a non-existent topic_key', async () => {
      const result = await client.callTool('mem_delete', {
        topic_key:    'nonexistent/topic-key-zzzxxx',
        project_path: TEST_PROJECT,
      });
      const t = text(result);
      assert(t === 'Memory not found.',
        `Expected "Memory not found.", got: "${t}"`);
    });

    await test('deleted memory no longer appears in mem_context', async () => {
      const result = await client.callTool('mem_context', { project_path: TEST_PROJECT });
      const t      = text(result);
      if (t === 'No recent context.') return; // nothing left — fine
      const memories = JSON.parse(t) as Memory[];
      const match    = memories.find(m => m.topic_key === TEST_TOPIC_KEY);
      assert(match == null, 'Soft-deleted memory should not appear in mem_context');
    });

    await test('deleted memory no longer appears in mem_search', async () => {
      const result = await client.callTool('mem_search', {
        keyword:      'Upsert check',
        project_path: TEST_PROJECT,
      });
      const t = text(result);
      if (t === 'No memories found.') return; // nothing left — fine
      const memories = JSON.parse(t) as Memory[];
      const match    = memories.find(m => m.topic_key === TEST_TOPIC_KEY);
      assert(match == null, 'Soft-deleted memory should not appear in mem_search');
    });

    await test('restores a soft-deleted memory when mem_finalize_session upserts it', async () => {
      await client.callTool('mem_finalize_session', {
        topic_key:         TEST_TOPIC_KEY,
        project_path:      TEST_PROJECT,
        problem_statement: 'Restoration check: upsert after soft-delete',
        solution_summary:  'ON CONFLICT sets deleted_at = NULL',
        affected_files:    'src/infrastructure/database/memory-repository.ts',
        key_learnings:     'Upsert always resurrects a deleted record',
      });

      const result   = await client.callTool('mem_context', { project_path: TEST_PROJECT });
      const t        = text(result);
      assert(t !== 'No recent context.', 'Memory should be restored in context');
      const memories = JSON.parse(t) as Memory[];
      const match    = memories.find(m => m.topic_key === TEST_TOPIC_KEY);
      assert(match != null, 'Restored memory should appear in mem_context');
      assert(match.content.includes('Restoration check'), 'Content should reflect the restored version');

      // Clean up: soft-delete the restored record so the test project stays tidy
      await client.callTool('mem_delete', {
        topic_key:    TEST_TOPIC_KEY,
        project_path: TEST_PROJECT,
      });
    });

  } finally {
    client.stop();
  }

  const total = passed + failed;
  console.log(`\n${total} test${total !== 1 ? 's' : ''}: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('\nFatal:', (err as Error).message);
  process.exit(1);
});
