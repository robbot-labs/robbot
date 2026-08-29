# Robbot Runtime Plugins

This directory owns third-party DSH/Cordis plugin dependencies that Robbot loads
into the DeepSeek Harness runtime.

Install standard DSH plugins here instead of modifying
`vendor/deepseek-harness/node_modules`. Robbot links this dependency layer into
the DSH module resolution path at startup and materializes declared dependencies
into the packaged runtime.

Example:

```sh
pnpm --dir runtime-plugins add dsh-video-creator@link:../vendor/dsh-video-creator
pnpm dev
```

`package.json` installs plugin packages. `manifest.json` controls whether Robbot
enables them in DSH Web:

```json
{
  "plugins": [
    {
      "name": "dsh-video-creator",
      "enabled": true,
      "source": "dsh-native"
    }
  ]
}
```

Robbot resolves runtime plugins before generating the DSH Web profile. The
resolver combines this manifest, each plugin package's `robbot` metadata, and
Robbot's UI slot contracts. Only a valid resolved plan may be materialized into
Cordis/profile files or used to start DSH.

Plugins that replace a single-owner UI surface should declare that in their own
`package.json`:

```json
{
  "robbot": {
    "ui": {
      "registrations": [
        {
          "slot": "sidebar",
          "role": "owner"
        }
      ]
    }
  }
}
```

If multiple enabled plugins declare ownership of the same single slot, Robbot
blocks startup before DSH loads. The desktop launcher presents the conflict as a
repairable enable/disable choice; CLI and sync scripts print diagnostics and
exit without writing an invalid profile. Do not use slot priority to resolve
product-level ownership conflicts: priority only controls the lower-level
HARNESS shadowing mechanism.
