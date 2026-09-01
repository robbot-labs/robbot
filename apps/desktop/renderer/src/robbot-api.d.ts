import type React from 'react';
import type { AiField } from '@robbot/core';

export interface HarnessRuntimeStatus {
  status: 'missing' | 'not_installed' | 'ready' | 'running';
  runtimeRoot: string;
}

export interface HarnessRunResult {
  runId: string;
  userMessageId: string;
  assistantMessageId: string;
  harnessSessionId: string;
  runMode: HarnessRunMode;
}

export type HarnessRunMode = 'sdk' | 'acp' | 'web';
export type HarnessStreamingCapability = 'none' | 'committed-message' | 'runtime-events';

export interface HarnessCapabilities {
  streaming: HarnessStreamingCapability;
  toolEvents: boolean;
  cancelCurrentRun: boolean;
  terminateRuntime: boolean;
  approval: boolean;
  sessionResume: boolean;
}

export type ActiveRunStatus = 'running' | 'waiting_approval' | 'cancelling';

export interface ActiveRunRef {
  runId: string;
  runMode: HarnessRunMode;
  harnessSessionId: string;
  assistantMessageId: string;
  status: ActiveRunStatus;
  capabilities: HarnessCapabilities;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatar?: string | null;
}

export interface SavedLogin {
  email: string;
  password: string;
}

export interface DesktopUpdateCheckResult {
  hasUpdate: boolean;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
  forceUpdate: boolean;
}

export interface DshWebViewTarget {
  url: string;
  partition: string;
  accountHash: string;
  fingerprint: string;
}

export type RuntimePluginPlanResult =
  | {
      ok: true;
      plan: ResolvedRuntimePluginPlan;
      diagnostics: RuntimePluginWarning[];
    }
  | {
      ok: false;
      diagnostics: RuntimePluginDiagnostic[];
    };

export interface RuntimePluginSettingsResult {
  plugins: RuntimePluginManifestEntry[];
  resolution: RuntimePluginPlanResult;
}

export interface RuntimePluginManifestEntry {
  name: string;
  enabled: boolean;
  source?: string;
  id?: string;
  config?: unknown;
}

export interface ResolvedRuntimePluginPlan {
  runtimePluginsRoot: string;
  manifestPath: string;
  packageManifestPath: string;
  nodeModulesPath: string;
  managedPluginNames: string[];
  enabledPluginNames: string[];
  plugins: ResolvedRuntimePlugin[];
}

export interface ResolvedRuntimePlugin {
  name: string;
  id: string;
  enabled: boolean;
  source?: string;
  displayName?: string;
  registrations: RuntimePluginUiRegistration[];
}

export interface RuntimePluginUiRegistration {
  slot: string;
  role: 'owner' | 'contribution';
}

export type RuntimePluginDiagnostic = RuntimePluginConflict | RuntimePluginWarning;

export type RuntimePluginConflict =
  | SingleSlotConflict
  | MissingPluginConflict
  | PluginDependencyConflict
  | IncompatiblePluginVersionConflict;

export interface SingleSlotConflict {
  kind: 'conflict';
  type: 'single-slot-conflict';
  slot: string;
  plugins: Array<{ name: string; displayName?: string }>;
}

export interface MissingPluginConflict {
  kind: 'conflict';
  type: 'missing-plugin';
  plugin: { name: string; displayName?: string };
  expectedPath: string;
}

export interface PluginDependencyConflict {
  kind: 'conflict';
  type: 'plugin-dependency-conflict';
  message: string;
}

export interface IncompatiblePluginVersionConflict {
  kind: 'conflict';
  type: 'incompatible-plugin-version';
  message: string;
}

export type RuntimePluginWarning = UnknownSlotRegistrationWarning | InvalidUiRegistrationWarning;

export interface UnknownSlotRegistrationWarning {
  kind: 'warning';
  type: 'unknown-slot-registration';
  plugin: { name: string; displayName?: string };
  slot: string;
}

export interface InvalidUiRegistrationWarning {
  kind: 'warning';
  type: 'invalid-ui-registration';
  plugin: { name: string; displayName?: string };
  message: string;
}

export interface HarnessRunInput {
  accountId: string;
  workspaceId: string;
  sessionId: string;
  prompt: string;
  runMode?: HarnessRunMode;
}

export interface HarnessWarmupInput {
  accountId: string;
  workspaceId: string;
  runMode?: HarnessRunMode;
}

export type HarnessEventType =
  | 'run.started'
  | 'assistant.delta'
  | 'assistant.reasoning.delta'
  | 'assistant.message'
  | 'tool.started'
  | 'tool.output'
  | 'tool.completed'
  | 'approval.required'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.interrupted';

export interface HarnessEvent {
  runId: string;
  sessionId: string;
  messageId?: string;
  harnessSessionId?: string;
  type: HarnessEventType;
  payload?: unknown;
}

export interface HarnessLogEntry {
  at: string;
  source: 'renderer' | 'main' | 'harness' | 'dsh';
  message: string;
  data?: Record<string, unknown>;
}

export type AccountStatus = 'active' | 'disabled';
export type SessionStatus = 'active' | 'archived';

export interface AccountRecord {
  id: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  status: AccountStatus;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  metadataJson: string | null;
  deepseek: string | null;
  openai: string | null;
  volcengine: string | null;
  customOpenai: string | null;
  selectedAi: string | null;
}

export interface WorkspaceRecord {
  id: string;
  accountId: string;
  name: string;
  rootPath: string;
  permissionPolicyJson: string;
  lastOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  workspaceId: string | null;
  title: string | null;
  activeSkillId: string | null;
  status: SessionStatus;
  lastMessageId: string | null;
  lastMessageAt: number | null;
  summary: string | null;
  harnessSessionId: string | null;
  harnessInstanceId: string | null;
  harnessAiProvider: string | null;
  harnessAiModel: string | null;
  harnessAiBaseUrl: string | null;
  harnessAiConfigFingerprint: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type MessageStatus = 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  retrySourceMessageId: string | null;
  retryPromptMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionEventRecord {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  payloadJson: string;
  createdAt: number;
}

export interface UpsertAccountInput {
  id: string;
  email?: string | null;
  username?: string | null;
  avatar?: string | null;
  status?: AccountStatus;
  metadata?: unknown;
}

export interface SaveWorkspaceInput {
  accountId: string;
  id?: string;
  name: string;
  rootPath: string;
  permissionPolicy?: unknown;
}

export interface CreateSessionInput {
  accountId: string;
  id?: string;
  workspaceId?: string | null;
  title?: string | null;
  activeSkillId?: string | null;
}

export interface RobbotApi {
  app: {
    getWindowKind: () => 'login' | 'main';
    showMainWindow: () => void;
    showLoginWindow: () => void;
    logoutAndShowLoginWindow: () => Promise<void>;
    isPackaged: boolean;
    platform: string;
    arch: string;
    getVersion: () => Promise<string>;
    checkUpdate: (input: { platform: string; arch: string; version: string; channel?: string }) => Promise<DesktopUpdateCheckResult>;
    openExternal: (url: string) => Promise<void>;
  };
  versions: {
    chrome: string;
    electron: string;
    node: string;
  };
  auth: {
    getCurrent: () => Promise<AuthUser | null>;
    getSavedLogin: () => Promise<SavedLogin | null>;
    login: (input: { email: string; password: string }) => Promise<AuthUser>;
    register: (input: { email: string; password: string }) => Promise<AuthUser>;
    logout: () => Promise<void>;
  };
  account: {
    getCurrent: () => Promise<AccountRecord>;
    updateAiConfig: (field: AiField, value: unknown) => Promise<AccountRecord>;
    saveAndSelectAi: (field: AiField, value: unknown) => Promise<AccountRecord>;
    selectAi: (selectedAi: AiField | null) => Promise<AccountRecord>;
    resetHarness: () => Promise<void>;
  };
  workspace: {
    list: (accountId: string) => Promise<WorkspaceRecord[]>;
    save: (input: SaveWorkspaceInput) => Promise<WorkspaceRecord>;
    selectDirectory: (accountId: string) => Promise<WorkspaceRecord | null>;
    rename: (accountId: string, workspaceId: string, name: string) => Promise<WorkspaceRecord>;
    delete: (accountId: string, workspaceId: string) => Promise<void>;
  };
  session: {
    list: (accountId: string, workspaceId?: string | null) => Promise<SessionRecord[]>;
    create: (input: CreateSessionInput) => Promise<SessionRecord>;
    rename: (accountId: string, sessionId: string, title: string) => Promise<SessionRecord>;
    archive: (accountId: string, sessionId: string) => Promise<SessionRecord>;
    delete: (accountId: string, sessionId: string) => Promise<void>;
  };
  message: {
    list: (sessionId: string) => Promise<MessageRecord[]>;
    listEvents: (sessionId: string) => Promise<SessionEventRecord[]>;
  };
  harness: {
    getStatus: () => Promise<HarnessRuntimeStatus>;
    resolveRuntimePlugins: () => Promise<RuntimePluginPlanResult>;
    getRuntimePlugins: () => Promise<RuntimePluginSettingsResult>;
    setRuntimePluginEnabled: (input: { name: string; enabled: boolean }) => Promise<RuntimePluginSettingsResult>;
    setRuntimePluginsEnabled: (input: { updates: Array<{ name: string; enabled: boolean }> }) => Promise<RuntimePluginSettingsResult>;
    applyRuntimePluginResolution: (input: { owners: Record<string, string> }) => Promise<RuntimePluginPlanResult>;
    restartRuntimeForPluginChange: () => Promise<void>;
    getCurrentWebUrl: () => Promise<DshWebViewTarget>;
    listActiveRuns: () => Promise<Record<string, ActiveRunRef>>;
    warmupRuntime: (input: HarnessWarmupInput) => Promise<void>;
    runPrompt: (input: HarnessRunInput) => Promise<HarnessRunResult>;
    retryMessage: (messageId: string) => Promise<HarnessRunResult>;
    cancel: (sessionId: string) => Promise<void>;
    approve: (sessionId: string, approvalId: string, approved: boolean) => Promise<void>;
    onLog: (listener: (entry: HarnessLogEntry) => void) => () => void;
    onEvent: (listener: (event: HarnessEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    robbot: RobbotApi;
  }

  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        webpreferences?: string;
      };
    }
  }
}
