import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import type { AiField } from '@robbot/core';

import type { AccountRecord } from '../../storage/repositories';

export interface AccountAiRuntime {
  accountId: string;
  accountHash: string;
  provider: AiField;
  dshProvider: 'deepseek-official' | 'openai';
  model?: string;
  key: string;
  apiUrl?: string;
  keyFingerprint: string;
  fingerprint: string;
}

export interface AccountDshEnvironment {
  accountHash: string;
  dshHome: string;
  partition: string;
  aiRuntime: AccountAiRuntime;
}

const webProfileMarkerVersion = 3;
const defaultDeepSeekModel = 'deepseek-v4-flash';
const defaultOpenAiModel = 'gpt-4.1';
const defaultVolcengineModel = 'ark-code-latest';
const volcengineCodingBaseUrl = 'https://ark.cn-beijing.volces.com/api/coding/v3';
const robbotOwnedSettingsSections = ['agent-default-model', 'llm-deepseek', 'llm-pi-ai'];

export class AccountDshEnvironmentService {
  resolve(account: AccountRecord): AccountDshEnvironment {
    const aiRuntime = aiRuntimeForAccount(account);
    if (!aiRuntime) {
      const provider = providerLabel(account.selectedAi);
      throw new Error(`${provider} API key is missing. Please open Settings and save the key first.`);
    }

    const dshHome = path.join(app.getPath('userData'), 'dsh-home', 'accounts', aiRuntime.accountHash);
    const settings = dshSettingsYaml(aiRuntime);
    const environment: AccountDshEnvironment = {
      accountHash: aiRuntime.accountHash,
      dshHome,
      partition: `persist:robbot-dsh-${aiRuntime.accountHash}`,
      aiRuntime: {
        ...aiRuntime,
        fingerprint: runtimeFingerprint({
          accountHash: aiRuntime.accountHash,
          provider: aiRuntime.provider,
          model: aiRuntime.model,
          apiUrl: aiRuntime.apiUrl,
          keyFingerprint: aiRuntime.keyFingerprint,
          dshHome,
          settings,
        }),
      },
    };

    this.sync(environment);
    return environment;
  }

  private sync(environment: AccountDshEnvironment): void {
    const webProfilePath = path.join(environment.dshHome, 'profiles', 'web');

    fs.mkdirSync(environment.dshHome, { recursive: true });
    resetWebProfileIfNeeded(webProfilePath, environment.aiRuntime.fingerprint);
    fs.mkdirSync(webProfilePath, { recursive: true });
    fs.writeFileSync(
      path.join(environment.dshHome, '.credentials.yaml'),
      credentialsYaml(environment.aiRuntime),
      { mode: 0o600 },
    );
    syncSettingsYaml(path.join(environment.dshHome, 'settings.yaml'), dshSettingsYaml(environment.aiRuntime));
    fs.writeFileSync(
      path.join(webProfilePath, '.robbot-profile.json'),
      `${JSON.stringify({
        version: webProfileMarkerVersion,
        fingerprint: environment.aiRuntime.fingerprint,
      }, null, 2)}\n`,
    );
  }
}

function resetWebProfileIfNeeded(webProfilePath: string, fingerprint: string): void {
  const markerPath = path.join(webProfilePath, '.robbot-profile.json');

  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
    if (marker.version === webProfileMarkerVersion && marker.fingerprint === fingerprint) {
      return;
    }
  } catch {
    // Missing or unreadable marker means this profile was created by an older
    // Robbot build or by DSH itself. Recreate only the web profile, not dshHome.
  }

  fs.rmSync(webProfilePath, { force: true, recursive: true });
}

function aiRuntimeForAccount(account: AccountRecord): Omit<AccountAiRuntime, 'fingerprint'> | undefined {
  const provider = account.selectedAi === 'openai' || account.selectedAi === 'volcengine' || account.selectedAi === 'customOpenai'
    ? account.selectedAi
    : 'deepseek';
  const raw = rawAiConfig(account, provider);
  if (!raw) return undefined;

  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const key = typeof value.key === 'string' ? value.key.trim() : '';
    if (!key) return undefined;
    const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : defaultModelForProvider(provider);
    const configuredApiUrl = typeof value.apiUrl === 'string' && value.apiUrl.trim() ? value.apiUrl.trim() : undefined;
    const apiUrl = provider === 'volcengine' ? normalizeVolcengineApiUrl(configuredApiUrl) : configuredApiUrl;
    if (provider === 'customOpenai' && (!model || !apiUrl)) {
      throw new Error('Custom OpenAI-compatible provider requires model and apiUrl in Settings.');
    }
    const accountHash = hash(account.id, 16);
    return {
      accountId: account.id,
      accountHash,
      provider,
      dshProvider: provider === 'deepseek' ? 'deepseek-official' : 'openai',
      model,
      key,
      apiUrl,
      keyFingerprint: hash(key, 12),
    };
  } catch {
    return undefined;
  }
}

function runtimeFingerprint(input: {
  accountHash: string;
  provider: string;
  model?: string;
  apiUrl?: string;
  keyFingerprint: string;
  dshHome: string;
  settings: string;
}): string {
  return hash(JSON.stringify(input), 32);
}

function credentialsYaml(aiRuntime: AccountAiRuntime): string {
  const entries: Record<string, string> = {};
  if (isOpenAiCompatibleProvider(aiRuntime.provider)) {
    entries.OPENAI_API_KEY = aiRuntime.key;
  } else {
    entries.DEEPSEEK_API_KEY = aiRuntime.key;
  }
  return [
    'version: 1',
    'refs:',
    ...Object.entries(entries).map(([key, value]) => `  ${key}: ${yamlString(value)}`),
    '',
  ].join('\n');
}

function dshSettingsYaml(aiRuntime: Omit<AccountAiRuntime, 'fingerprint'>): string {
  return isOpenAiCompatibleProvider(aiRuntime.provider)
    ? openAiSettingsYaml(aiRuntime)
    : deepSeekSettingsYaml(aiRuntime);
}

function deepSeekSettingsYaml(aiRuntime: Omit<AccountAiRuntime, 'fingerprint'>): string {
  const model = aiRuntime.model ?? defaultDeepSeekModel;
  const lines = [
    'agent-default-model:',
    '  provider: deepseek-official',
    `  model: ${yamlString(model)}`,
    '',
    'llm-deepseek:',
    '  apiKeyEnv: DEEPSEEK_API_KEY',
  ];
  if (aiRuntime.apiUrl) {
    lines.push(`  baseURL: ${yamlString(aiRuntime.apiUrl)}`);
  }
  lines.push(
    '  models:',
    `    - id: ${yamlString(model)}`,
    `      name: ${yamlString(model)}`,
    '      contextWindow: 1000000',
    '',
  );
  return lines.join('\n');
}

function openAiSettingsYaml(aiRuntime: Omit<AccountAiRuntime, 'fingerprint'>): string {
  const model = aiRuntime.model ?? defaultModelForProvider(aiRuntime.provider);
  const lines = [
    'agent-default-model:',
    '  provider: openai',
    `  model: ${yamlString(model)}`,
    '',
    'llm-pi-ai:',
    '  providers:',
    '    openai:',
    '      apiKeyEnv: OPENAI_API_KEY',
  ];
  if (aiRuntime.apiUrl) {
    lines.push(`      baseURL: ${yamlString(aiRuntime.apiUrl)}`);
  }
  lines.push(
    '      models:',
    `        - id: ${yamlString(model)}`,
    `          name: ${yamlString(model)}`,
    '          contextWindow: 1000000',
    '',
  );
  return lines.join('\n');
}

function defaultModelForProvider(provider: AccountAiRuntime['provider']): string {
  if (provider === 'deepseek') return defaultDeepSeekModel;
  if (provider === 'volcengine') return defaultVolcengineModel;
  if (provider === 'openai') return defaultOpenAiModel;
  return '';
}

function normalizeVolcengineApiUrl(apiUrl: string | undefined): string {
  if (!apiUrl || apiUrl === 'https://ark.cn-beijing.volces.com/api/v3' || apiUrl === 'https://ark.cn-beijing.volces.com/api/coding') {
    return volcengineCodingBaseUrl;
  }
  return apiUrl;
}

function rawAiConfig(account: AccountRecord, provider: AiField): string | null {
  if (provider === 'openai') return account.openai;
  if (provider === 'volcengine') return account.volcengine;
  if (provider === 'customOpenai') return account.customOpenai;
  return account.deepseek;
}

function isOpenAiCompatibleProvider(provider: AiField): boolean {
  return provider === 'openai' || provider === 'volcengine' || provider === 'customOpenai';
}

function providerLabel(provider: string | null): string {
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'volcengine') return '火山';
  if (provider === 'customOpenai') return '自定义 OpenAI 接口';
  return 'DeepSeek';
}

function syncSettingsYaml(settingsPath: string, robbotSettings: string): void {
  const existing = safeReadFile(settingsPath);
  const preserved = existing === undefined
    ? ''
    : removeTopLevelSections(existing, robbotOwnedSettingsSections).trimEnd();
  const next = [
    preserved,
    preserved ? '' : undefined,
    '# Robbot projects the selected account AI provider into DSH user settings.',
    '# Edit the Robbot account settings, not this generated block.',
    robbotSettings.trimEnd(),
    '',
  ].filter((line): line is string => line !== undefined).join('\n');
  if (existing !== next) {
    fs.writeFileSync(settingsPath, next, { mode: 0o600 });
  }
}

function safeReadFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function removeTopLevelSections(content: string, sectionNames: string[]): string {
  const blocked = new Set(sectionNames);
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const match = /^([A-Za-z0-9_-]+):(?:\s.*)?$/.exec(line);
    if (match && !line.startsWith(' ')) {
      skipping = blocked.has(match[1]);
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function hash(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}
