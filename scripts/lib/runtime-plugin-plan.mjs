import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const ROBBOT_SLOT_DEFINITIONS = Object.freeze({
  sidebar: { cardinality: 'single' },
  header: { cardinality: 'single' },
  statusbar: { cardinality: 'single' },
  'workspace-root': { cardinality: 'single' },
  'settings-root': { cardinality: 'single' },
  'sidebar.items': { cardinality: 'multiple' },
  'settings.plugin.item': { cardinality: 'multiple' },
  commands: { cardinality: 'multiple' },
  pages: { cardinality: 'multiple' },
  panels: { cardinality: 'multiple' },
});

/**
 * Resolve Robbot runtime plugin state, package metadata, and platform contracts
 * into the single plan representation allowed to drive DSH materialization.
 */
export function resolveRuntimePluginPlan(input = {}) {
  const repoRoot = input.repoRoot ? path.resolve(input.repoRoot) : process.cwd();
  const runtimePluginsRoot = input.runtimePluginsRoot
    ? path.resolve(input.runtimePluginsRoot)
    : path.join(repoRoot, 'runtime-plugins');
  const manifestPath = input.manifestPath ?? path.join(runtimePluginsRoot, 'manifest.json');
  const packageManifestPath = input.packageManifestPath ?? path.join(runtimePluginsRoot, 'package.json');
  const nodeModulesPath = input.nodeModulesPath ?? path.join(runtimePluginsRoot, 'node_modules');
  const slotDefinitions = input.slotDefinitions ?? ROBBOT_SLOT_DEFINITIONS;

  const diagnostics = [];
  const installedPackageNames = readRuntimePluginPackageNames(packageManifestPath);
  const manifestPlugins = readRuntimePluginManifest(manifestPath, diagnostics);
  const managedPackageNames = uniqueStrings([
    ...installedPackageNames,
    ...manifestPlugins.map((plugin) => plugin.name),
  ]);

  const resolvedPlugins = manifestPlugins.map((plugin) => {
    const packageRoot = path.join(nodeModulesPath, plugin.name);
    const packageJsonPath = path.join(packageRoot, 'package.json');
    const packageExists = existsSync(packageJsonPath);
    const packageMetadata = packageExists
      ? readPluginPackageMetadata(plugin, packageJsonPath, diagnostics)
      : { displayName: undefined, registrations: [] };
    const displayName = packageMetadata.displayName;
    const registrations = normalizeRegistrations(plugin.name, packageMetadata.registrations, slotDefinitions, diagnostics);

    if (plugin.enabled && !packageExists) {
      diagnostics.push({
        kind: 'conflict',
        type: 'missing-plugin',
        plugin: { name: plugin.name, displayName },
        expectedPath: packageRoot,
      });
    }

    return {
      ...plugin,
      displayName,
      packageRoot,
      registrations,
    };
  });

  diagnostics.push(...singleSlotConflicts(resolvedPlugins, slotDefinitions));

  const conflicts = diagnostics.filter((diagnostic) => diagnostic.kind === 'conflict');
  const warnings = diagnostics.filter((diagnostic) => diagnostic.kind === 'warning');
  if (conflicts.length > 0 || (input.strictWarnings === true && warnings.length > 0)) {
    return {
      ok: false,
      diagnostics,
    };
  }

  return {
    ok: true,
    plan: {
      runtimePluginsRoot,
      manifestPath,
      packageManifestPath,
      nodeModulesPath,
      managedPluginNames: managedPackageNames,
      enabledPluginNames: resolvedPlugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.name),
      plugins: resolvedPlugins,
    },
    diagnostics: warnings,
  };
}

export function assertValidRuntimePluginPlan(input = {}) {
  const result = resolveRuntimePluginPlan(input);
  if (!result.ok) {
    throw new RuntimePluginPlanError(result.diagnostics);
  }
  return result;
}

export class RuntimePluginPlanError extends Error {
  constructor(diagnostics) {
    super(formatRuntimePluginDiagnostics(diagnostics));
    this.name = 'RuntimePluginPlanError';
    this.code = 'runtime_plugin_plan_invalid';
    this.diagnostics = diagnostics;
  }
}

export function formatRuntimePluginDiagnostics(diagnostics) {
  const lines = ['Runtime plugin configuration is invalid.'];
  for (const diagnostic of diagnostics) {
    if (diagnostic.type === 'single-slot-conflict') {
      lines.push(`- single slot "${diagnostic.slot}" has multiple owners: ${diagnostic.plugins.map(formatPluginLabel).join(', ')}`);
      continue;
    }
    if (diagnostic.type === 'missing-plugin') {
      lines.push(`- enabled plugin is missing: ${formatPluginLabel(diagnostic.plugin)} (${diagnostic.expectedPath})`);
      continue;
    }
    if (diagnostic.type === 'plugin-dependency-conflict') {
      lines.push(`- plugin dependency conflict: ${diagnostic.message}`);
      continue;
    }
    if (diagnostic.type === 'incompatible-plugin-version') {
      lines.push(`- incompatible plugin version: ${diagnostic.message}`);
      continue;
    }
    if (diagnostic.type === 'unknown-slot-registration') {
      lines.push(`- unknown slot registration in ${formatPluginLabel(diagnostic.plugin)}: "${diagnostic.slot}"`);
      continue;
    }
    if (diagnostic.type === 'invalid-ui-registration') {
      lines.push(`- invalid UI registration in ${formatPluginLabel(diagnostic.plugin)}: ${diagnostic.message}`);
      continue;
    }
    lines.push(`- ${diagnostic.type ?? 'unknown diagnostic'}`);
  }
  return lines.join('\n');
}

function readRuntimePluginManifest(manifestPath, diagnostics) {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const plugins = Array.isArray(parsed?.plugins) ? parsed.plugins : [];
    return plugins
      .filter((plugin) => plugin && typeof plugin === 'object' && typeof plugin.name === 'string')
      .map((plugin) => ({
        name: plugin.name,
        id: typeof plugin.id === 'string' ? plugin.id : plugin.name,
        enabled: plugin.enabled === true,
        source: typeof plugin.source === 'string' ? plugin.source : undefined,
        config: plugin.config && typeof plugin.config === 'object' && !Array.isArray(plugin.config) ? plugin.config : {},
      }));
  } catch (error) {
    diagnostics.push({
      kind: 'conflict',
      type: 'missing-plugin',
      plugin: { name: path.basename(path.dirname(manifestPath)) || 'runtime-plugins' },
      expectedPath: manifestPath,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function readRuntimePluginPackageNames(packageManifestPath) {
  try {
    const parsed = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
    return uniqueStrings([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.optionalDependencies ?? {}),
    ]);
  } catch {
    return [];
  }
}

function readPluginPackageMetadata(plugin, packageJsonPath, diagnostics) {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return {
      displayName: typeof parsed.displayName === 'string'
        ? parsed.displayName
        : typeof parsed.description === 'string'
          ? undefined
          : undefined,
      registrations: Array.isArray(parsed?.robbot?.ui?.registrations) ? parsed.robbot.ui.registrations : [],
    };
  } catch (error) {
    if (plugin.enabled) {
      diagnostics.push({
        kind: 'conflict',
        type: 'missing-plugin',
        plugin: { name: plugin.name },
        expectedPath: path.dirname(packageJsonPath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return { displayName: undefined, registrations: [] };
  }
}

function normalizeRegistrations(pluginName, registrations, slotDefinitions, diagnostics) {
  const seen = new Set();
  const normalized = [];
  for (const registration of registrations) {
    if (!registration || typeof registration !== 'object') {
      diagnostics.push({
        kind: 'warning',
        type: 'invalid-ui-registration',
        plugin: { name: pluginName },
        message: 'registration must be an object',
      });
      continue;
    }

    const slot = registration.slot;
    const role = registration.role;
    if (typeof slot !== 'string' || slot.trim() === '') {
      diagnostics.push({
        kind: 'warning',
        type: 'invalid-ui-registration',
        plugin: { name: pluginName },
        message: 'slot must be a non-empty string',
      });
      continue;
    }
    if (role !== 'owner' && role !== 'contribution') {
      diagnostics.push({
        kind: 'warning',
        type: 'invalid-ui-registration',
        plugin: { name: pluginName },
        message: `unsupported role for slot "${slot}"`,
      });
      continue;
    }

    if (!slotDefinitions[slot]) {
      diagnostics.push({
        kind: 'warning',
        type: 'unknown-slot-registration',
        plugin: { name: pluginName },
        slot,
      });
    }

    const key = `${pluginName}\u0000${slot}\u0000${role}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ slot, role });
  }
  return normalized;
}

function singleSlotConflicts(plugins, slotDefinitions) {
  const ownerPluginsBySlot = new Map();
  for (const plugin of plugins) {
    if (!plugin.enabled) {
      continue;
    }
    for (const registration of plugin.registrations) {
      const definition = slotDefinitions[registration.slot];
      if (!definition || definition.cardinality !== 'single' || registration.role !== 'owner') {
        continue;
      }
      const owners = ownerPluginsBySlot.get(registration.slot) ?? new Map();
      owners.set(plugin.name, { name: plugin.name, displayName: plugin.displayName });
      ownerPluginsBySlot.set(registration.slot, owners);
    }
  }

  const conflicts = [];
  for (const [slot, owners] of ownerPluginsBySlot) {
    if (owners.size <= 1) {
      continue;
    }
    conflicts.push({
      kind: 'conflict',
      type: 'single-slot-conflict',
      slot,
      plugins: [...owners.values()],
    });
  }
  return conflicts;
}

function formatPluginLabel(plugin) {
  return plugin.displayName ? `${plugin.displayName} (${plugin.name})` : plugin.name;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
