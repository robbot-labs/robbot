import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRuntimePluginPlan } from './runtime-plugin-plan.mjs';

test('detects enabled single slot owners for the same slot', () => {
  const root = fixture({
    manifest: [
      { name: 'plugin-a', enabled: true },
      { name: 'plugin-b', enabled: true },
    ],
    packages: {
      'plugin-a': [{ slot: 'sidebar', role: 'owner' }],
      'plugin-b': [{ slot: 'sidebar', role: 'owner' }],
    },
  });

  try {
    const result = resolveRuntimePluginPlan({ runtimePluginsRoot: root });
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnostics.filter((item) => item.type === 'single-slot-conflict'), [
      {
        kind: 'conflict',
        type: 'single-slot-conflict',
        slot: 'sidebar',
        plugins: [
          { name: 'plugin-a', displayName: undefined },
          { name: 'plugin-b', displayName: undefined },
        ],
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dedupes repeated registrations from the same plugin', () => {
  const root = fixture({
    manifest: [{ name: 'plugin-a', enabled: true }],
    packages: {
      'plugin-a': [
        { slot: 'sidebar', role: 'owner' },
        { slot: 'sidebar', role: 'owner' },
      ],
    },
  });

  try {
    const result = resolveRuntimePluginPlan({ runtimePluginsRoot: root });
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.plugins[0].registrations, [{ slot: 'sidebar', role: 'owner' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allows multiple settings plugin item contributions', () => {
  const root = fixture({
    manifest: [
      { name: 'plugin-a', enabled: true },
      { name: 'plugin-b', enabled: true },
    ],
    packages: {
      'plugin-a': [{ slot: 'settings.plugin.item', role: 'contribution' }],
      'plugin-b': [{ slot: 'settings.plugin.item', role: 'contribution' }],
    },
  });

  try {
    const result = resolveRuntimePluginPlan({ runtimePluginsRoot: root, strictWarnings: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('warns on unknown slots and strict mode rejects warnings', () => {
  const root = fixture({
    manifest: [{ name: 'plugin-a', enabled: true }],
    packages: {
      'plugin-a': [{ slot: 'siderbar', role: 'owner' }],
    },
  });

  try {
    const normal = resolveRuntimePluginPlan({ runtimePluginsRoot: root });
    assert.equal(normal.ok, true);
    assert.equal(normal.diagnostics[0].type, 'unknown-slot-registration');

    const strict = resolveRuntimePluginPlan({ runtimePluginsRoot: root, strictWarnings: true });
    assert.equal(strict.ok, false);
    assert.equal(strict.diagnostics[0].type, 'unknown-slot-registration');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports enabled missing plugins as conflicts', () => {
  const root = fixture({
    manifest: [{ name: 'missing-plugin', enabled: true }],
    packages: {},
  });

  try {
    const result = resolveRuntimePluginPlan({ runtimePluginsRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].type, 'missing-plugin');
    assert.equal(result.diagnostics[0].plugin.name, 'missing-plugin');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(input) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'robbot-runtime-plugin-plan-'));
  mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify({ plugins: input.manifest }, null, 2)}\n`);
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'robbot-runtime-plugins',
    private: true,
    dependencies: Object.fromEntries(Object.keys(input.packages).map((name) => [name, `link:./node_modules/${name}`])),
  }, null, 2)}\n`);

  for (const [name, registrations] of Object.entries(input.packages)) {
    const packageRoot = path.join(root, 'node_modules', name);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name,
      version: '0.0.0-test',
      robbot: { ui: { registrations } },
    }, null, 2)}\n`);
  }

  return root;
}
