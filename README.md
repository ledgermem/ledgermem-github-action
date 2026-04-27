# LedgerMem GitHub Action

Add to or search a [LedgerMem](https://ledgermem.dev) workspace from any GitHub Actions workflow.

## Usage

### Save a CHANGELOG entry to memory after every release

```yaml
name: Capture release notes
on:
  release:
    types: [published]

jobs:
  capture:
    runs-on: ubuntu-latest
    steps:
      - uses: ledgermem/ledgermem-github-action@v1
        with:
          api-key: ${{ secrets.LEDGERMEM_API_KEY }}
          workspace-id: ${{ vars.LEDGERMEM_WORKSPACE_ID }}
          operation: add
          content: |
            Release ${{ github.event.release.tag_name }}

            ${{ github.event.release.body }}
          metadata: |
            {
              "kind": "release",
              "tag": "${{ github.event.release.tag_name }}",
              "url": "${{ github.event.release.html_url }}"
            }
```

### Look up prior context inside a PR check

```yaml
name: Recall context
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  recall:
    runs-on: ubuntu-latest
    steps:
      - id: lm
        uses: ledgermem/ledgermem-github-action@v1
        with:
          api-key: ${{ secrets.LEDGERMEM_API_KEY }}
          workspace-id: ${{ vars.LEDGERMEM_WORKSPACE_ID }}
          operation: search
          query: ${{ github.event.pull_request.title }}
          limit: "5"

      - name: Comment with related memories
        if: steps.lm.outputs.results != '[]'
        uses: actions/github-script@v7
        with:
          script: |
            const results = JSON.parse(`${{ steps.lm.outputs.results }}`);
            const lines = results.map(r => `- ${r.content.split('\n')[0]}`).join('\n');
            await github.rest.issues.createComment({
              ...context.repo,
              issue_number: context.issue.number,
              body: `**Related context from LedgerMem:**\n${lines}`,
            });
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `api-key` | yes | — | LedgerMem API key (use a secret) |
| `workspace-id` | yes | — | Workspace to read/write |
| `operation` | yes | `add` | `add` or `search` |
| `content` | when `operation=add` | `""` | Memory body |
| `query` | when `operation=search` | `""` | Search string |
| `limit` | no | `10` | Max search results (1-100) |
| `metadata` | no | `{}` | JSON object attached to a new memory |
| `endpoint` | no | `https://api.ledgermem.dev` | Override for self-hosted |

## Outputs

| Output | Description |
| --- | --- |
| `results` | JSON array of `{id, content, createdAt, score, metadata}`. `[]` for `add`. |
| `memory-id` | ID of the newly created memory. Empty for `search`. |

## Development

```bash
npm install
npm run type-check
npm test                # vitest with mocked @actions/core and SDK
npm run build           # ncc bundle into dist/index.js (commit it)
```

The `dist/` directory is committed so consumers can use this action without a build step.

## License

MIT — see [LICENSE](./LICENSE).
