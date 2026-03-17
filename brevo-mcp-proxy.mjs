#!/usr/bin/env node
// Simple stdio-to-streamable-http MCP proxy for Brevo
// Uses curl subprocess to respect https_proxy env var

import { createInterface } from 'readline';
import { execFileSync, execSync } from 'child_process';

const MCP_URL = 'https://mcp.brevo.com/v1/brevo/mcp';
const TOKEN = process.env.BREVO_MCP_TOKEN;

const rl = createInterface({ input: process.stdin });

let sessionId = null;

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);

    const headerFile = `/tmp/brevo-mcp-headers-${process.pid}.txt`;
    const args = [
      '-s',
      '-D', headerFile,
      '-H', 'Content-Type: application/json',
      '-H', 'Accept: application/json, text/event-stream',
      '-H', `api-key: ${TOKEN}`,
    ];

    if (sessionId) {
      args.push('-H', `Mcp-Session-Id: ${sessionId}`);
    }

    args.push('-d', JSON.stringify(request), MCP_URL);

    const result = execFileSync('curl', args, {
      encoding: 'utf-8',
      timeout: 30000,
    });

    // Try to read session ID from response headers
    try {
      const respHeaders = execFileSync('cat', [headerFile], { encoding: 'utf-8' });
      const match = respHeaders.match(/mcp-session-id:\s*(.+)/i);
      if (match) {
        sessionId = match[1].trim();
      }
    } catch {}

    // Parse response - could be SSE or JSON
    const trimmed = result.trim();
    if (trimmed.includes('event:') && trimmed.includes('data:')) {
      const lines = trimmed.split('\n');
      for (const l of lines) {
        if (l.startsWith('data: ')) {
          const data = l.slice(6).trim();
          if (data) {
            process.stdout.write(data + '\n');
          }
        }
      }
    } else if (trimmed) {
      process.stdout.write(trimmed + '\n');
    }
  } catch (err) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.id !== undefined) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          error: { code: -32000, message: err.message }
        }) + '\n');
      }
    } catch {}
  }
});
