import { test, expect } from '@playwright/test'

test.describe('tRPC API', () => {
  const trcpRequest = async (request: any, path: string, input?: any) => {
    const url = input
      ? `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `/api/trpc/${path}`

    return request.get(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  test('should respond to stats.dashboard query', async ({ request }) => {
    const response = await trcpRequest(request, 'stats.dashboard')

    expect(response.status()).toBe(200)

    const json = await response.json()
    expect(json).toHaveProperty('result')
    expect(json.result).toHaveProperty('data')
    expect(json.result.data).toHaveProperty('servers')
    expect(json.result.data).toHaveProperty('channels')
    expect(json.result.data).toHaveProperty('jobsRun')
    expect(json.result.data).toHaveProperty('totalMessages')
  })

  test('should respond to config.get query', async ({ request }) => {
    const response = await trcpRequest(request, 'config.get')

    expect(response.status()).toBe(200)

    const json = await response.json()
    expect(json).toHaveProperty('result')
    expect(json.result.data).toHaveProperty('id')
    expect(json.result.data).toHaveProperty('discordToken')
    expect(json.result.data).toHaveProperty('exportFormat')
  })

  test('should respond to server.list query', async ({ request }) => {
    const response = await trcpRequest(request, 'server.list')

    expect(response.status()).toBe(200)

    const json = await response.json()
    expect(json).toHaveProperty('result')
    expect(Array.isArray(json.result.data)).toBe(true)
  })

  test('should return array of jobs', async ({ request }) => {
    const response = await trcpRequest(request, 'job.recent', { limit: 20 })

    expect(response.status()).toBe(200)

    const json = await response.json()
    expect(json).toHaveProperty('result')
    expect(Array.isArray(json.result.data)).toBe(true)
  })
})
