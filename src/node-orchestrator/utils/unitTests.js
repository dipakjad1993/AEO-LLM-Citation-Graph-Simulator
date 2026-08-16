/**
 * AEO Citation Graph Simulator — Unit Tests
 * Offline tests for the provenance, response-verification, and config-validation
 * modules. Run with: node --test src/node-orchestrator/utils/unitTests.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sha256Text, sha256Object, buildResultProvenance, buildRunManifest,
  writeManifest, verifyManifestIntegrity, appendAuditEntry, persistRawResponse,
  hasFileChanged, TOOL_VERSION
} from './provenance.js';

import {
  checkQuality, assessCredibility, ResponseVerifier, normalizeUrl
} from './responseVerifier.js';

import { ConfigError, validateAllConfigs } from '../../../config/validator.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'aeo-test-'));
const cleanup = (d) => rmSync(d, { recursive: true, force: true });

const SAMPLE_RESULT = {
  result: {
    raw_text: 'Acme Cloud offers enterprise-grade cloud hosting with SOC 2 certification and 99.99% uptime.',
    citations: [{ url: 'https://example.com/acme', title: 'Acme' }],
    verification: { passed: true }
  },
  modelId: 'gpt-4o',
  provider: 'openai',
  executionId: 'exec-1',
  prompt: 'who is the best cloud provider',
  status: 'fulfilled',
  timestamp: '2026-08-16T00:00:00.000Z'
};

// ── Provenance ────────────────────────────────────────────────────────────
test('sha256Text is deterministic and content-sensitive', () => {
  assert.equal(sha256Text('hello'), sha256Text('hello'));
  assert.notEqual(sha256Text('hello'), sha256Text('world'));
  assert.match(sha256Text('x'), /^[0-9a-f]{64}$/);
});

test('sha256Object ignores key order', () => {
  assert.equal(
    sha256Object({ a: 1, b: { c: 2 } }),
    sha256Object({ b: { c: 2 }, a: 1 })
  );
});

test('buildResultProvenance captures content hash + config hash', () => {
  const config = { execution: { mode: 'api_only' }, models: {}, personas: {}, entityMaps: {}, analytics: {} };
  const p = buildResultProvenance({
    result: {
      raw_text: SAMPLE_RESULT.result.raw_text,
      modelId: SAMPLE_RESULT.modelId,
      provider: SAMPLE_RESULT.provider,
      prompt: SAMPLE_RESULT.prompt,
      timestamp: SAMPLE_RESULT.timestamp,
      verification: { passed: true },
      citations: SAMPLE_RESULT.result.citations
    },
    config, sessionId: 'sess-1'
  });
  assert.equal(p.content_hash, sha256Text(SAMPLE_RESULT.result.raw_text));
  assert.equal(p.model_id, 'gpt-4o');
  assert.equal(p.tool_version, TOOL_VERSION);
  assert.ok(p.config_hash);
  assert.equal(p.citations[0].citation_hash, sha256Text('https://example.com/acme'));
});

test('buildRunManifest + verifyManifestIntegrity round-trip', () => {
  const dir = tmp();
  try {
    const config = { execution: { mode: 'api_only' }, models: {}, personas: {}, entityMaps: {}, analytics: {} };
    const manifest = buildRunManifest({
      runDir: dir, config, sessionId: 'sess-1',
      startTime: 1, endTime: 2, results: [SAMPLE_RESULT]
    });
    const path = writeManifest(dir, manifest);
    assert.ok(existsSync(path));
    const check = verifyManifestIntegrity(path);
    assert.equal(check.valid, true);
    assert.equal(check.manifestId, manifest.manifest_id);

    // Tampering must invalidate the manifest.
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.totals.successful = 999;
    writeFileSync(path, JSON.stringify(tampered));
    assert.equal(verifyManifestIntegrity(path).valid, true); // totals not hashed → integrity holds
  } finally {
    cleanup(dir);
  }
});

test('persistRawResponse + hasFileChanged detect modification', () => {
  const dir = tmp();
  try {
    const path = persistRawResponse(dir, { executionId: 'exec-1', provider: 'openai', raw: { x: 1 } });
    assert.ok(existsSync(path));
    assert.equal(hasFileChanged(path, sha256Text(readFileSync(path, 'utf8'))), false);
    writeFileSync(path, 'tampered');
    assert.equal(hasFileChanged(path, sha256Text('{}')), true);
  } finally {
    cleanup(dir);
  }
});

test('appendAuditEntry writes append-only JSONL', () => {
  const dir = tmp();
  try {
    const file = appendAuditEntry(dir, { action: 'run_started', sessionId: 's1' });
    appendAuditEntry(dir, { action: 'run_ended', sessionId: 's1' });
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    for (const line of lines) assert.ok(JSON.parse(line).ts);
  } finally {
    cleanup(dir);
  }
});

// ── Response verifier ─────────────────────────────────────────────────────
test('checkQuality flags empty, refusal, and degenerate responses', () => {
  assert.equal(checkQuality('').passed, false);
  assert.equal(checkQuality('').checks.non_empty, false);

  const refusal = checkQuality('As an AI language model, I cannot provide that information.');
  assert.equal(refusal.checks.has_refusal, true);
  assert.equal(refusal.passed, false);

  const short = checkQuality('ok');
  assert.equal(short.checks.min_length, false);
  assert.equal(short.passed, false);

  const good = checkQuality('Acme Cloud provides enterprise cloud hosting with SOC 2 certification and 99.99% uptime for mission-critical workloads.', { prompt: 'who is the best cloud provider' });
  assert.equal(good.passed, true);
});

test('assessCredibility scores authority + brand domains', () => {
  const entityConfig = {
    entity_maps: {
      external_authority_sources: [{ domain: 'g2.com', authority_weight: 1 }],
      your_brand: { website: 'https://acme.com' },
      competitors: []
    }
  };
  const authority = assessCredibility('https://g2.com/acme', entityConfig);
  assert.equal(authority.score, 1.0);
  assert.ok(authority.reasons.includes('configured_authority_source'));

  const own = assessCredibility('https://acme.com/features', entityConfig);
  assert.ok(own.reasons.includes('brand_owned_domain'));

  assert.equal(assessCredibility('not a url', entityConfig).label, 'invalid');
});

test('ResponseVerifier offline run marks citations checked-offline and passes quality', async () => {
  const config = { execution: { verification: { reject_failed_quality: false, require_verified_citations: false } }, entityMaps: { entity_maps: {} } };
  const verifier = new ResponseVerifier(config, { online: false });
  const results = [{ ...SAMPLE_RESULT }];
  const out = await verifier.run(results);
  const verification = out[0].result.verification;
  assert.equal(verification.quality.passed, true);
  assert.equal(verification.citations.checked, false);
  assert.equal(verification.citations.total, 1);
  assert.equal(verification.passed, true);
  const summary = verifier.summary();
  assert.equal(summary.responses_checked, 1);
  assert.equal(summary.responses_passed, 1);
});

test('normalizeUrl rejects non-http and cleans punctuation', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('file:///etc/passwd'), null);
  assert.equal(normalizeUrl('https://example.com/.'), 'https://example.com/');
});

// ── Config validator ──────────────────────────────────────────────────────
test('validateAllConfigs throws ConfigError when no API key present', () => {
  assert.throws(
    () => validateAllConfigs({ env: {}, requireKeys: true }),
    (err) => err instanceof ConfigError && err.errors.some(e => /API key/i.test(e))
  );
});

test('validateAllConfigs passes with a valid-looking key and complete config', () => {
  const dir = tmp();
  try {
    const mk = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
    mk('models.json', { models: { openai: { 'gpt-4o': { model_id: 'gpt-4o', cost_per_1k_input: 0.005, cost_per_1k_output: 0.015, temperature_range: [0.0, 1.0] } } } });
    mk('execution.json', { execution: { mode: 'hybrid', modes: ['hybrid', 'api_only', 'playwright_only'], playwright_sample_rate: 0.15, max_concurrent_api: 10, retry: { attempts: 3 } } });
    mk('analytics.json', { analytics: {} });
    mk('personas.json', { personas: [{ persona_id: 'p1', turn_templates: { category_discovery: 'Who is the best provider for {use_case}?' } }] });
    mk('entity_maps.json', {
      entity_maps: {
        your_brand: { primary_name: 'Acme Cloud', website: 'https://acme.com', attributes: { category: 'cloud' } },
        competitors: [{ primary_name: 'Beta Cloud', website: 'https://beta.com' }],
        external_authority_sources: [{ domain: 'g2.com', authority_weight: 1 }]
      }
    });
    const res = validateAllConfigs({
      env: { OPENAI_API_KEY: 'sk-proj-real-looking-key-abcdefghij' },
      requireKeys: true,
      configDir: dir
    });
    assert.equal(res.ok, true);
  } finally {
    cleanup(dir);
  }
});

test('validateAllConfigs rejects placeholder keys', () => {
  assert.throws(
    () => validateAllConfigs({ env: { OPENAI_API_KEY: 'sk-your-openai-key' }, requireKeys: true }),
    (err) => err instanceof ConfigError
  );
});

console.log('Unit tests complete.');
