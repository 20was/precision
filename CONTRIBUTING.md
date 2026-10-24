# Contributing

Thanks for helping improve Precision. The project is early in development, so focused bug reports and small, reviewable changes are especially useful.

## Before opening an issue

- Search existing issues for the same problem.
- Include the browser and version, operating system, and steps to reproduce.
- For capture accuracy issues, include the page structure or a small local fixture when possible. Remove private page content from screenshots.

## Before opening a pull request

1. Open an issue for large changes so the intended behavior can be discussed first.
2. Keep changes within the currently supported feature set unless the issue agrees otherwise.
3. Run `npm ci` and `npm run check`.
4. Run `npm run test:integration` for changes to capture, selection, permissions, or extension lifecycle.
5. Describe user-visible changes, test results, and any remaining browser-specific limitations.

Do not add remote services, broad host permissions, analytics, or dependencies without explaining why they are needed.
