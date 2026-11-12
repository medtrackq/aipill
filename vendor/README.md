# Vendored libraries

| File | Package | Version | License |
|---|---|---|---|
| `anthropic-sdk-1.3.0.min.mjs` | [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) | 1.3.0 | Apache-2.0 / MIT (`anthropic-sdk.LICENSE`, `anthropic-sdk.LICENSE-MIT`) |

The SDK is bundled here instead of being loaded from a CDN, because it handles
the user's API key. It is loaded only when an AI feature is used.

Rebuild (from an empty folder):

```bash
npm i @anthropic-ai/sdk@1.3.0 esbuild@0.25
echo "export { default, Anthropic } from '@anthropic-ai/sdk';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=eof --outfile=anthropic-sdk-1.3.0.min.mjs
```
