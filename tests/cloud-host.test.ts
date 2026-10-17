import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cloudEnvironment } from '../scripts/cloud-host.ts';

test('cloud host binds only the web publicly, follows the platform port and canonical HTTPS domain', () => {
  const env = cloudEnvironment({ PORT: '8080', RAILWAY_PUBLIC_DOMAIN: 'intelligence.example.test', WEB_PORT: '3010', API_BASE_URL: 'http://localhost:3011' });
  assert.equal(env.WEB_PORT, '8080');
  assert.equal(env.WEB_HOST, '0.0.0.0');
  assert.equal(env.API_HOST, '127.0.0.1');
  assert.equal(env.API_BASE_URL, 'http://127.0.0.1:3001');
  assert.equal(env.SITE_URL, 'https://intelligence.example.test');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(cloudEnvironment({ PORT: '3001' }).API_PORT, '3002');
  assert.equal(cloudEnvironment({ SITE_URL: 'https://custom.example/' }).SITE_URL, 'https://custom.example');
});

test('cloud configuration refuses a local-only proxy and conflicting or malformed ports', () => {
  for (const proxy of ['http://127.0.0.1:7890', 'http://localhost:7890', 'http://[::1]:7890']) {
    assert.throws(() => cloudEnvironment({ MODEL_PROXY_URL: proxy }), /this computer/);
    assert.throws(() => cloudEnvironment({ EGRESS_PROXY_URL: proxy }), /this computer/);
  }
  for (const port of ['0', 'NaN', '65536', '3.5']) assert.throws(() => cloudEnvironment({ PORT: port }), /ports/);
  assert.throws(() => cloudEnvironment({ PORT: '3000', API_PORT: '3000' }), /ports/);
  assert.equal(cloudEnvironment({ MODEL_PROXY_URL: 'https://egress.example.test' }).MODEL_PROXY_URL, 'https://egress.example.test');
});
