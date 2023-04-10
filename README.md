# Changed Files Action

This GitHub action applies to pull request, push, and merge group workflow triggers and populates 3 output variables with the modified files: `files_created`, `files_updated`, and `files_deleted`.

### Workflow Config Example

```yml
- name: Changed Files Exporter
  uses: ScratchAddons/changed-files@master
  with:
    repo-token: ${{ github.token }}
    pattern: '^.*\.(md|markdown)$'
```

### Inputs

- `repo-token`: GitHub Access Token
- `pattern` (optional): A regular expression to filter the outputs by. Defaults to `'.*'`.
- `pr-number` (optional): The pull request number. If not provided, the pull request is inferred from the given context. Useful for actions running outside the `pull_request` event context.
- `result-encoding` (optional): The encoding for the output values, either `'string'` (default) or `'json'`.

### Outputs

All output values are either a newline-separated string, or a JSON encoded array.

- `files_created`: Created files
- `files_updated`: Updated files
- `files_deleted`: Deleted files
