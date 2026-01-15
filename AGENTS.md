# Repository Guidelines

## Project Structure & Module Organization
- **Extension core** lives in `src/`.
  - `src/boot.js` is the entry point that initializes the extension.
  - `src/virtualization.js` contains the virtual scrolling logic.
  - `src/background.js` is the service worker for lifecycle and settings.
  - `src/popup.html`, `src/popup.css`, and `src/popup.js` define the settings UI.
- **Manifests** are at the repo root: `manifest.json` (Chrome) and `manifest_firefox.json` (Firefox).
- **Assets** are in `icons/`.
- **Docs** live in `README.md` and related markdown files.

## Build, Test, and Development Commands
- `npm test`: Placeholder test script (currently exits with an error). Use it only if you add a real test runner.
- **Local development**: Load the repo as an unpacked extension in your browser and reload the extension after code changes.

## Coding Style & Naming Conventions
- Use **2-space indentation** for JavaScript, HTML, and JSON files.
- Prefer **camelCase** for variables/functions and **PascalCase** for classes.
- Keep file names descriptive and consistent with existing patterns (`popup.js`, `virtualization.js`).
- Avoid adding try/catch around imports.

## Testing Guidelines
- There is **no automated test suite** today. If you add tests, document the runner in `package.json` and update this file.
- When touching behavior, validate manually by loading the extension in Chrome/Firefox and checking ChatGPT performance.

## Commit & Pull Request Guidelines
- Follow the existing **Conventional Commits** style seen in `git log` (e.g., `feat:`, `fix:`, `docs:`, `refactor:`).
- Keep commit subjects short and imperative.
- Pull requests should include:
  - A clear summary of changes.
  - Manual testing notes (browser + steps).
  - Screenshots for UI changes (popup or visual adjustments).

## Coding constraints
- Do not introduce frameworks or new dependencies.
- Use existing scroller.config, scroller.state, and scroller.log patterns.

## Security & Configuration Tips
- Do not add remote code execution or external analytics.
- Respect minimal permissions in manifests and keep changes scoped to ChatGPT domains only.


## Developer Documentation
### Technical Analysis
A comprehensive overview the extension is evailable for agents. It details the extension's architecture, functionality, and the rationale behind its design choices. I hope that you find it useful.

- [dev-docs/TECHNICAL_README.md](dev-docs/TECHNICAL_README.md)

### Inifiniate Scroll
Developers and agents should make use of and make reference to the following MSDN documentation items where necessicary:

- [dev-docs/2.2-the-IntersectionObserver-interface.md](dev-docs/2.2-the-IntersectionObserver-interface.md)
- [dev-docs/2.3-the-IntersectionObserverEntry-interface.md](dev-docs/2.3-the-IntersectionObserverEntry-interface.md)
- [dev-docs/2.4-the-intersectionObserverInit-dictionary.md](dev-docs/2.4-the-intersectionObserverInit-dictionary.md)
