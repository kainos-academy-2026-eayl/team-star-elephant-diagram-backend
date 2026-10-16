import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.ts'

let server
let baseUrl

before(async () => {
  server = createApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
})

test('GET / returns a Hello World HTML page', async () => {
  const response = await fetch(`${baseUrl}/`)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  assert.match(await response.text(), /<h1>Hello World<\/h1>/)
})

test('GET /health returns UP and the current ISO timestamp', async () => {
  const beforeRequest = Date.now()
  const response = await fetch(`${baseUrl}/health`)
  const body = await response.json()
  const afterRequest = Date.now()

  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(Object.keys(body).sort(), ['status', 'time'])
  assert.equal(body.status, 'UP')
  assert.equal(typeof body.time, 'string')
  const timestamp = Date.parse(body.time)
  assert.ok(timestamp >= beforeRequest && timestamp <= afterRequest)
  assert.equal(new Date(timestamp).toISOString(), body.time)
})
