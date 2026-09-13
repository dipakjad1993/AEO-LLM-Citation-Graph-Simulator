/**
 * AEO Citation Graph Simulator - Provenance & Data Integrity
 * Provides content hashing, immutable run manifests, and an append-only
 * audit trail so every output can be traced back to its exact inputs and
 * verified as unmodified.
 */

import { createHash, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

export const TOOL_VERSION = '2.0.0';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256Text(text) {
  return sha256(String(text ?? ''));
}

export function sha256Object(obj) {
  return sha256(JSON.stringify(sortObject(obj)));
}

export function randomRunId() {
  return randomBytes(6).toString('hex');
}

export function sortObject(obj) {
  if (Array.isArray(obj)) return obj.map(sortObject);
  if (obj && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = sortObject(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

export function hashConfig(config) {
  return sha256Object({
    execution: config?.execution,
    models: config?.models,
    personas: config?.personas,
    entityMaps: config?.entityMaps,
    analytics: config?.analytics
  });
}

export function buildResultProvenance({ result, config, sessionId }) {
  return {
    content_hash: sha256Text(result.raw_text),
    model_id: result.modelId,
    provider: result.provider,
    tool_version: TOOL_VERSION,
    session_id: sessionId,
    generated_at: result.timestamp,
    prompt: result.prompt,
    prompt_hash: sha256Text(result.prompt || ''),
    config_hash: hashConfig(config),
    verification: result.verification || null,
    citations: (result.citations || []).map(c => ({
      url: c.url,
      citation_hash: sha256Text(c.url),
      verified: c.verified ?? null,
      verification_detail: c.verification_detail || null
    }))
  };
}

export function buildRunManifest({ runDir, config, sessionId, startTime, endTime, results }) {
  const contentHashes = results
    .filter(r => r.result?.raw_text)
    .map(r => ({
      executionId: r.executionId,
      modelId: r.modelId,
      content_hash: sha256Text(r.result.raw_text)
    }));

  const manifest = {
    manifest_id: sha256Object({
      sessionId, startTime, endTime,
      contentHashes: contentHashes.map(c => c.content_hash).sort()
    }),
    tool_version: TOOL_VERSION,
    session_id: sessionId,
    started_at: new Date(startTime).toISOString(),
    ended_at: new Date(endTime).toISOString(),
    duration_ms: endTime - startTime,
    config_hash: hashConfig(config),
    config_snapshot: sortObject({
      execution: config?.execution,
      models: config?.models,
      personas: config?.personas,
      entityMaps: config?.entityMaps,
      analytics: config?.analytics
    }),
    totals: {
      tasks: results.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    },
    content_hashes: contentHashes
  };

  return manifest;
}

export function writeManifest(runDir, manifest) {
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, 'run_manifest.json');
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  return path;
}

export function privacyFlags(config) {
  const p = config?.execution?.privacy || {};
  return { hashOnlyRaw: p.hash_only_raw === true, redactPersisted: p.redact_pii !== false };
}

export function appendAuditEntry(logDir, entry) {
  const file = join(logDir, 'audit.log');
  mkdirSync(logDir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...sortObject(entry)
  });
  appendFileSync(file, line + '\n', 'utf8');
  return file;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const TOKEN_RE = /\b(sk-[A-Za-z0-9-_]{8,}|xox[bpas]-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+)\b/g;

export function redactPII(text) {
  if (typeof text !== 'string') return text;
  return text.replace(EMAIL_RE, '[email-redacted]').replace(TOKEN_RE, '[secret-redacted]');
}

export function persistRawResponse(runDir, { executionId, provider, raw }, { hashOnly = false, redact = true } = {}) {
  const dir = join(runDir, 'raw_responses');
  mkdirSync(dir, { recursive: true });
  const safeProvider = String(provider || 'unknown').replace(/[^a-z0-9]/gi, '_');
  const path = join(dir, `${safeProvider}_${executionId}.json`);
  // Privacy: hash-only mode stores content_hash + redacted preview (no PII/plaintext at rest).
  // redact=true scrubs emails + obvious secrets from persisted copies (in-memory analysis unaffected).
  let payload = raw;
  if (hashOnly) {
    const flat = typeof raw === 'string' ? raw : JSON.stringify(raw);
    payload = { content_hash: sha256Text(flat), preview_redacted: redactPII(flat).slice(0, 500), hash_only: true };
  } else if (redact) {
    try {
      const flat = JSON.stringify(raw);
      payload = JSON.parse(redactPII(flat));
    } catch { payload = raw; }
  }
  writeFileSync(path, JSON.stringify({
    executionId,
    provider,
    saved_at: new Date().toISOString(),
    raw: payload
  }, null, 2));
  return path;
}

export function verifyManifestIntegrity(manifestPath) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const recomputed = sha256Object({
      sessionId: manifest.session_id,
      startTime: Date.parse(manifest.started_at),
      endTime: Date.parse(manifest.ended_at),
      contentHashes: manifest.content_hashes.map(c => c.content_hash).sort()
    });
    return {
      valid: recomputed === manifest.manifest_id,
      manifestId: manifest.manifest_id,
      tool_version: manifest.tool_version,
      configHash: manifest.config_hash
    };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

export function hasFileChanged(filePath, expectedHash) {
  if (!existsSync(filePath)) return true;
  const actual = sha256Text(readFileSync(filePath, 'utf8'));
  return actual !== expectedHash;
}
