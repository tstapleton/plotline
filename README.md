# plotline

Sequence diagrams of what your Angular feature actually did, recorded from its tests and
diffed on every pull request.

While your integration tests run, plotline records each user action, the calls between
components, NgRx SignalStores and services, the data passed and how store state
changed, and draws each test as a sequence diagram. On a pull request it does the same
for the base branch and posts a highlighted diff, so reviewers see how the feature's
behaviour changed, not just its code.

See it on the pull requests of [tstapleton/birdseed](https://github.com/tstapleton/birdseed), a recipe, meal plan and grocery list app.

## Install

The package is on GitHub Packages, which needs a token even for public packages. In the
app's `.npmrc`:

```
@tstapleton:registry=https://npm.pkg.github.com
```

and locally, a [personal access token](https://github.com/settings/tokens) with
`read:packages` in your user `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=YOUR_TOKEN
```

Then `npm install @tstapleton/plotline`. It's a regular dependency, not a dev one,
because stores import `withTracing` from it. In the app that import does nothing.

## Set up

Mark each store, after the features to trace and before `withHooks`:

```ts
import { withTracing } from '@tstapleton/plotline/store';

export const RecipesStore = signalStore(
  withState(initialState),
  withComputed(/* … */),
  withMethods(/* … */),
  withTracing('Recipes store'),
  withHooks({ onInit: (store) => store.load() }),
);
```

Then opt in the tests to record. No Jest config changes are needed: plotline only
touches spec files that call `recordPlotline()`, so in a large repo the rest of the suite
is unaffected. The simplest place is the helper that renders your feature, since every
spec that imports it is then recorded.

In that helper, name the services that should appear in the diagrams. Your mocks stay
as they are; only the provider is wrapped:

```ts
import { provideTracing, recordPlotline, traced } from '@tstapleton/plotline/jest';

recordPlotline(); // records the spec files that import this helper

await render(App, {
  providers: [
    traced('Recipes API', { provide: RecipesApi, useValue: recipesApiMock }, { group: 'Backend (mocked)' }),
    traced('Grocery adder', GroceryAdder, { group: 'Kitchen app' }),
    provideTracing({ ui: 'UI', group: 'Kitchen app' }),
  ],
});
```

- `traced(name, provider, { group, methods })` makes a service, real or mocked, a
  participant. `group` draws it inside a titled box. `methods` limits which of its
  methods appear.
- `provideTracing({ ui, group })` switches recording on for the render, and names the
  UI and the box it and the stores sit in.

- `recordPlotline()` registers hooks in the spec file that calls it (directly or through
  a helper it imports), and patches Angular's change detection only while that file runs.

All three do nothing unless the run sets `PLOTLINE=1`, so ordinary test runs are
unaffected. On CI, point the action's `test-command` at just your feature's tests, e.g.
`npx jest src/app/features/recipes`.

## Use it locally

```bash
PLOTLINE=1 npx jest src/app/features/recipes        # plotline/<spec>/<test>.json and .md (Mermaid)
npx plotline report plotline --out plotline/report   # one HTML page, rendered with Pele
npx plotline diff <base-dir> <head-dir> --out plotline-diff [--again <head-dir-2>]
npx plotline stable <run-dir> <run-dir>              # exit 1 if any test recorded differently
```

`PLOTLINE_DIR` changes where traces are written, so two runs can sit side by side.
Running your tests twice into different directories and then `plotline stable` is the
quickest way to find test doubles that use random ids or the real clock.

## Use it on pull requests

```yaml
name: Plotline
on:
  pull_request:

permissions:
  contents: read
  packages: read
  pull-requests: write

jobs:
  behaviour-diff:
    runs-on: ubuntu-latest
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://npm.pkg.github.com
          scope: '@tstapleton'
      - uses: tstapleton/plotline@v0
```

The action checks out the PR's base in a worktree outside the workspace, installs and
runs the tests on both sides with `PLOTLINE=1`, and diffs them. It uploads the HTML report
as an artifact, then posts a comment, or updates its earlier one.

| Input | Default | |
|---|---|---|
| `working-directory` | `.` | The app's directory |
| `install-command` | `npm ci --no-audit --no-fund` | Runs in both checkouts |
| `install-head` | `true` | `false` if the workflow already installed the PR checkout |
| `test-command` | `npx jest` | Runs with `PLOTLINE=1` and `PLOTLINE_DIR` set |
| `check-stability` | `true` | Run the PR's tests twice and flag tests that record differently |
| `base-ref` | the PR's base commit | |
| `comment` | `true` | Post the PR comment |

A public package can be installed with any workflow's own token, so nothing else needs
setting up.

## Reading a diff

The comment starts with **What changed**: each change in words, such as
"**Meal plan store** now calls **Grocery API** `lists()`". A change that shows up in
several tests is listed once, with how many tests show it, and calls rank above state
changes and reordering. Each changed test then lists its own changes and shows its diff
diagram.

If the stability check found tests that record differently on two runs of the same
code, a warning comes first, with an example of what differed for each.

Diagrams number each user action ①, ②, … with the steps before the first under
"Setup". In a diff, an action whose steps didn't change collapses to one line naming
it.

Tests are paired by spec file and name. A test that exists on only one side counts as
**renamed** when at least 60% of its steps match a test on the other side.

| Mark | Meaning |
|---|---|
| `+` | added: only happens on the PR side |
| `−` | removed: only happens on the base side |
| `Δ` | changed: same participants and method (or state keys), different data; a note shows the old value |
| `↕` | moved: the same message at a different point within the same user action |

New participants are labelled `(new)`, and ones no longer called are labelled
`(removed)`. Within a changed user action, unchanged stretches longer than two steps
either side of a change are collapsed.

## How recording works

- **Participants.** Store methods and the methods of `traced` services are wrapped. A
  call between two participants becomes `A ->> B: method(args)`, and its result becomes
  a return arrow. For an Observable, each emission becomes a return arrow; for a Promise,
  the resolved value does.
- **Who is calling.** The current participant is kept in Node's `AsyncLocalStorage`.
  Work that continues after a timer, an observable emission or an `await` is still
  attributed correctly. Calls a participant makes to itself are left out, so the diagram
  shows boundaries only.
- **Components.** A call made from a component (its template, a lifecycle hook or a
  method) is drawn from that component, e.g. `RecipeDetailPage ->> Recipe store`. User
  actions go to the component whose template holds the element, and a component's
  `output()` is drawn as a message to the parent listening to it, so a click in a child
  reads `User ->> Stepper`, `Stepper ->> Page: changed(4)`, `Page ->> Store`. This uses
  the debugging
  helpers Angular publishes in development mode, which TestBed runs in. (`@Output()`
  EventEmitters aren't drawn yet, only `output()`.) Anything plotline
  can't place, such as change detection, is the generic UI.
- **State.** `watchState` turns each `patchState` into a note of what changed
  (`status: "loading" → "ready"`). Lists of entities are compared by id
  (`recipes[r-1].favorite: false → true`).
- **User.** Capture-phase DOM listeners turn input, change and click events into
  `User ->> Component` messages, named by the control's label. Repeated keystrokes on one field
  are merged into one step.

## Known limits

- Tests must record the same thing every run. Random ids, real timestamps and
  `Date.now()` in your test doubles show up as changes on every PR. Give mocks
  predictable ids and a fixed clock; the stability check points these out.
- A diagram shows one run, the path this test took. It is not every possible path.
- `withTracing` must come after the features it should cover and before `withHooks`.
- Computeds the store doesn't expose are evaluated in their reader's context. Calls they
  make can show up as coming from the UI.
- Effects or timers driven by Jest fake timers run in the test's context, so they are
  attributed to the UI.
- Patching computeds relies on Angular's internal signal node (`SIGNAL`). That's
  acceptable in test-only code, but it can break on an Angular upgrade.
- Labels summarise data (`{id: "vendor-onboarding", …}`). A change hidden inside the
  summary won't show as `Δ`.

## Releasing

Every merge to `main` publishes the next patch version to GitHub Packages, tags it
`vX.Y.Z`, and moves the `v0` tag that workflows use. It needs no secrets beyond the
workflow's own token.

## Develop

```bash
npm ci
npm test            # unit tests for the diff and summaries
npm run typecheck
npm run build       # dist/: ESM for apps and the CLI, CommonJS for Jest
```
