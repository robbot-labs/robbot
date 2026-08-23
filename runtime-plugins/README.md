# Robbot Runtime Plugins

This directory owns third-party DSH/Cordis plugin dependencies that Robbot loads
into the DeepSeek Harness runtime.

Install standard DSH plugins here instead of modifying
`vendor/deepseek-harness/node_modules`. Robbot links this dependency layer into
the DSH module resolution path at startup and materializes declared dependencies
into the packaged runtime.

Example:

```sh
pnpm --dir runtime-plugins add dsh-article-creator@link:../vendor/dsh-article-creator
pnpm dev
```

`package.json` installs plugin packages. `manifest.json` controls whether Robbot
enables them in DSH Web:

```json
{
  "plugins": [
    {
      "name": "dsh-article-creator",
      "enabled": true,
      "source": "dsh-native"
    }
  ]
}
```
