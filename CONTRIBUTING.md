# Contributing

Thanks for helping. RxPlus is a small, self-hosted app, so the process is light, but it's about medications, so a few rules are strict.

## Before you start

- **Bugs and ideas:** open an issue first for anything bigger than a small fix, so we can agree on the approach before you write code.
- **Security problems:** don't open an issue; see [SECURITY.md](SECURITY.md).
- **Never post your own health information** (your medications, conditions or doses) in issues, pull requests, screenshots or test data. Use made-up examples; the tests use lisinopril, atorvastatin and spironolactone.

## Set up and run

Follow "Develop (developers)" in the [README](README.md#develop-developers): Node 24, Docker for the databases, Chrome for the end-to-end tests. In short:

```bash
npm ci
npm run lint && npm run format:check
npm test                               # unit
npm run db:test:up && npm run test:int # integration (throwaway PostgreSQL)
npm run e2e                            # end-to-end (production build, stubbed upstream APIs)
```

## Making a change

1. Branch from `main`. Pull requests are required to change `main`.
2. Keep to how the code is organized: see the project layout in the README and [CAPABILITY-MAP.md](CAPABILITY-MAP.md). A new feature starts with a short spec (`SPEC-<module>.md`) agreed in an issue.
3. Add or update tests at the level that fits: unit for logic, integration for routes and SQL, end-to-end for user flows.
4. For UI changes, follow [docs/design.md](docs/design.md) and check light and dark, 375 px and desktop, and keyboard focus.
5. Run lint, formatting, unit and integration tests, and `npm run build` (it type-checks templates). CI runs them on every pull request.
6. Write commit messages like `feat(digest): …` or `fix(login): …` and say why, not only what.

## Rules that aren't negotiable

- The app **never recommends** starting, stopping, switching or dosing a medication, in UI text or AI output.
- **Interaction severity comes from structured data** (DDInter), never from AI wording.
- **Every AI-written sentence is tied to its source** (label text or abstract), and unsupported sentences are marked as such.
- **Accounts are private from each other:** anything read from a user's medications, digests or hides is scoped to the signed-in user, with tests for two users.
- **No secrets or health data** in commits, logs or fixtures. Recorded API fixtures are public data only (see [NOTICE.md](NOTICE.md)).

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE), the same as the rest of the code.
