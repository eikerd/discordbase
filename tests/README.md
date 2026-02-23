# Playwright Tests for Discordbase

## Setup

Tests are already configured with `@playwright/test`. No additional setup needed.

## Running Tests

```bash
# Run all tests
bun run test

# Run tests in UI mode (interactive, visual)
bun run test:ui

# Debug mode (step through tests)
bun run test:debug

# Show HTML report after running
bun run test:report
```

## Test Files

- **`homepage.spec.ts`**: Tests the dashboard UI, theme, and component visibility
- **`api.spec.ts`**: Tests tRPC API endpoints and responses

## Using with AI Agent

### With Claude Code
1. Tell Claude: "Test the app with Playwright"
2. Claude can:
   - Run `bun run test` to execute tests
   - Analyze test failures
   - Write new tests for features
   - Use the Playwright browser snapshots to understand app state

### Writing New Tests

Example test pattern:
```typescript
import { test, expect } from '@playwright/test'

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/')

    // Find elements
    await expect(page.getByText('Text')).toBeVisible()

    // Interact
    await page.getByRole('button', { name: /Button/i }).click()

    // Assert
    await expect(page.getByText('Result')).toBeVisible()
  })
})
```

## Test Coverage Goals

- [ ] Sprint 1: Settings page load, token input validation, Docker status
- [ ] Sprint 2: Server add/remove, channel CRUD, scrape trigger
- [ ] Sprint 3: Dashboard stats update, activity feed refresh, scheduler status
- [ ] Sprint 4: Job history pagination, filter/sort, error details
- [ ] Sprint 5: Full user workflow (add server → add channels → trigger scrape)

## CI/CD Integration

Playwright tests are configured to run in:
- **CI mode** (GitHub Actions, etc): Single worker, retries enabled
- **Local mode**: Parallel browsers, reuses running server

To run tests in CI mode locally:
```bash
CI=true bun run test
```
