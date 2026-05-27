#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const bucket = process.env.OPS_HEALTH_BUCKET || 'ops-health';
const objectName = process.env.OPS_HEALTH_OBJECT || 'ops-health.summary.json';
const summaryPath = process.env.OPS_HEALTH_SUMMARY_PATH || path.join('ops-health', 'ops-health.summary.json');

const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const content = await fs.readFile(summaryPath, 'utf8');

JSON.parse(content);

await ensureBucket();
await uploadSummary();

console.log(`Published ${summaryPath} to ${bucket}/${objectName}`);
console.log(`Public URL: ${supabaseUrl}/storage/v1/object/public/${bucket}/${objectName}`);

async function ensureBucket() {
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
  const existing = await fetch(bucketUrl, { headers: authHeaders() });
  const existingText = await existing.text();

  if (existing.ok) {
    const metadata = safeJson(existingText);
    if (metadata?.public === true) return;
    const updated = await fetch(bucketUrl, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: true }),
    });
    if (updated.ok) return;
    throw new Error(`bucket public update failed: ${updated.status} ${await updated.text()}`);
  }
  if (existing.status !== 404 && !isBucketNotFound(existing.status, existingText)) {
    throw new Error(`bucket lookup failed: ${existing.status} ${existingText}`);
  }

  const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  });

  if (created.ok || created.status === 409) return;
  throw new Error(`bucket create failed: ${created.status} ${await created.text()}`);
}

async function uploadSummary() {
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(objectName)}`;
  const uploaded = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'x-upsert': 'true',
    },
    body: content,
  });

  if (uploaded.ok) return;
  throw new Error(`summary upload failed: ${uploaded.status} ${await uploaded.text()}`);
}

function authHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function encodePath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function isBucketNotFound(status, text) {
  if (status !== 400) return false;
  const body = safeJson(text);
  return body?.error === 'Bucket not found' || body?.message === 'Bucket not found' || body?.statusCode === '404';
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
