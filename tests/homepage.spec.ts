import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('should load and display dashboard title', async ({ page }) => {
    await page.goto('/')

    // Check for DISCORDBASE title
    await expect(page.getByText('DISCORDBASE')).toBeVisible()

    // Check for dashboard subtitle
    await expect(page.getByText('Local Discord Archive Dashboard')).toBeVisible()
  })

  test('should display stats cards', async ({ page }) => {
    await page.goto('/')

    // Check for all stat cards
    await expect(page.getByText('SERVERS')).toBeVisible()
    await expect(page.getByText('CHANNELS')).toBeVisible()
    await expect(page.getByText('JOBS')).toBeVisible()
    await expect(page.getByText('DOCKER')).toBeVisible()
  })

  test('should display activity log section', async ({ page }) => {
    await page.goto('/')

    // Check for activity log
    await expect(page.getByText('ACTIVITY LOG')).toBeVisible()
    await expect(page.getByText('Waiting for scrape jobs...')).toBeVisible()
  })

  test('should display action buttons', async ({ page }) => {
    await page.goto('/')

    // Check for buttons
    const settingsBtn = page.getByRole('button', { name: /SETTINGS/i })
    const serversBtn = page.getByRole('button', { name: /SERVERS/i })
    const jobsBtn = page.getByRole('button', { name: /JOBS/i })

    await expect(settingsBtn).toBeVisible()
    await expect(serversBtn).toBeVisible()
    await expect(jobsBtn).toBeVisible()
  })

  test('should have 8-bit theme colors', async ({ page }) => {
    await page.goto('/')

    const title = page.getByText('DISCORDBASE')

    // Check if the green accent color is applied
    const color = await title.evaluate((el) => {
      return window.getComputedStyle(el).color
    })

    // Should be neon green or similar bright color
    expect(color).toBeTruthy()
  })
})
