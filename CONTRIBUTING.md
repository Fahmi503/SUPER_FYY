# Contributing to SUPER FYY

Thank you for your interest in contributing to SUPER FYY.

## Development Workflow

1. Fork the repository and create your branch from `master`.
2. Ensure you have Node.js 22+ installed.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run compilation:
   ```bash
   npm run build
   ```
5. Execute the test suite before submitting changes:
   ```bash
   npm test
   ```

## Guidelines

- Keep changes minimal and focused.
- Ensure all automated unit and benchmark tests pass (68/68 test suite).
- Follow TypeScript ESM conventions.
- Never commit credentials, personal paths, or internal private project data.
