import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    username: text('username'),
    avatar: text('avatar'),
    status: text('status', { enum: ['active', 'disabled'] }).notNull().default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastLoginAt: integer('last_login_at'),
    authToken: text('auth_token'),
    authExp: integer('auth_exp'),
    savedPassword: text('saved_password'),
    savedPasswordUpdatedAt: integer('saved_password_updated_at'),
    metadataJson: text('metadata_json'),
    /*
    {
      "key": "...",
      "model": "..."
    }
    */
    deepseek: text('deepseek'),
    /*
    {
      "key": "...",
      "model": "...",
      "apiUrl": "..."
    }
    */
    openai: text('openai'),
    /*
    {
      "key": "...",
      "model": "...",
      "apiUrl": "..."
    }
    */
    volcengine: text('volcengine'),
    /*
    {
      "key": "...",
      "model": "...",
      "apiUrl": "..."
    }
    */
    customOpenai: text('custom_openai'),
    // openai | deepseek | volcengine | customOpenai
    selectedAi: text('selected_ai'),
  },
  (table) => ({
    emailUnique: uniqueIndex('accounts_email_unique').on(table.email),
    statusIdx: index('accounts_status_idx').on(table.status),
  }),
);

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    permissionPolicyJson: text('permission_policy_json').notNull().default('{}'),
    lastOpenedAt: integer('last_opened_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => ({
    accountRootPathUnique: uniqueIndex('workspaces_account_root_path_unique').on(table.accountId, table.rootPath),
    accountLastOpenedIdx: index('workspaces_account_last_opened_idx').on(table.accountId, table.lastOpenedAt),
    accountDeletedIdx: index('workspaces_account_deleted_idx').on(table.accountId, table.deletedAt),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, {
        onDelete: 'cascade',
      }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    title: text('title'),
    activeSkillId: text('active_skill_id'),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    lastMessageId: text('last_message_id'),
    lastMessageAt: integer('last_message_at'),
    summary: text('summary'),
    harnessSessionId: text('harness_session_id'),
    harnessInstanceId: text('harness_instance_id'),
    harnessAiProvider: text('harness_ai_provider'),
    harnessAiModel: text('harness_ai_model'),
    harnessAiBaseUrl: text('harness_ai_base_url'),
    harnessAiConfigFingerprint: text('harness_ai_config_fingerprint'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => ({
    accountLastMessageIdx: index('sessions_account_last_message_idx').on(table.accountId, table.lastMessageAt),
    workspaceLastMessageIdx: index('sessions_workspace_last_message_idx').on(table.workspaceId, table.lastMessageAt),
    accountStatusIdx: index('sessions_account_status_idx').on(table.accountId, table.status),
    accountDeletedIdx: index('sessions_account_deleted_idx').on(table.accountId, table.deletedAt),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, {
        onDelete: 'cascade',
      }),
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    content: text('content').notNull(),
    status: text('status', { enum: ['streaming', 'completed', 'failed', 'cancelled', 'interrupted'] })
      .notNull()
      .default('completed'),
    retrySourceMessageId: text('retry_source_message_id'),
    retryPromptMessageId: text('retry_prompt_message_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    sessionCreatedIdx: index('messages_session_created_idx').on(table.sessionId, table.createdAt),
  }),
);

// Product-side projection of DSH's append-only session event log. The DSH JSONL
// log remains authoritative; this table makes the Electron/SQLite UI restartable
// without rebuilding the whole conversation on every paint.
export const sessionEvents = sqliteTable(
  'session_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    sessionSeqUnique: uniqueIndex('session_events_session_seq_unique').on(table.sessionId, table.seq),
    sessionSeqIdx: index('session_events_session_seq_idx').on(table.sessionId, table.seq),
  }),
);

export const schema = {
  accounts,
  workspaces,
  sessions,
  messages,
  sessionEvents,
};
