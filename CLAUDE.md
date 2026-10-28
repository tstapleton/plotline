# plotline

Records sequence diagrams of Angular + NgRx SignalStore features while their Jest
integration tests run, and diffs them between a pull request and its base. Ships as an
npm package (`@tstapleton/plotline` on GitHub Packages) and a composite GitHub Action
(`action.yml`). See `README.md` for how it's used and how recording works.

## Layout

| Path | What's there |
|---|---|
| `src/store` | `withTracing`, the SignalStore feature apps add (`@tstapleton/plotline/store`) |
| `src/jest` | The test-side recorder: tracer, DOM recorder, Jest hooks (`@tstapleton/plotline/jest`) |
| `src/core` | Trace model, merging, Mermaid rendering |
| `src/diff` | Aligning two runs, describing changes, the PR comment and HTML diff |
| `src/report` | Loading traces and the single-run HTML report |
| `src/cli.ts` | The `plotline` CLI (`report`, `diff`, `stable`) used by the action |
| `test/` | Unit tests (Node's test runner via `tsx`) |

## Commands

| Command | Purpose |
|---|---|
| `npm ci` | Install dependencies (also installs the Husky pre-commit hook) |
| `npm run build` | Bundle `src/` → `dist/` with tsup |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests |
| `npm run lint` | Biome lint + format check |
| `npm run format` | Apply Biome formatting and safe fixes |
| `npm run verify` | Typecheck, lint, test, build and `npm pack --dry-run`; runs on pre-commit and in CI |

## Development workflow

- Never commit to `main`. Work on a branch and land it through a pull request; `main`
  has a ruleset requiring a PR, a passing `verify` check and squash merging, and the
  pre-commit hook refuses commits on `main`.
- Every merge to `main` publishes a new patch version and moves the `v0` tag that
  other repos' workflows use (`release.yml`), so treat merging as releasing.
- Work in a worktree rather than the main checkout, so parallel sessions don't share a
  working tree: `git worktree add -b <branch> .worktrees/<branch> origin/main`, then
  run `npm ci` in it. `.worktrees/` is git-ignored.
- `origin` is an SSH remote, which can't connect from the sandbox; fetch and push over
  HTTPS (`https://github.com/tstapleton/plotline.git`).
- Multiple commits per PR are fine — they're squashed on merge.
- Don't add features, refactoring or cleanup beyond what the task needs.

## Always / Never

**Always:**
- Run `npm run verify` before asking for review.
- Keep `action.yml` and the CLI in step: the action calls `plotline diff` with specific
  flags, so changing the CLI's interface means updating the action in the same PR.

**Never:**
- Use `--no-verify` to skip the pre-commit hook.
- Commit or push to `main`.
- Add a dependency without pinning an exact version (`.npmrc` sets `save-exact`).
