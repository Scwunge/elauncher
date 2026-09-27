/**
 * The Wardrobe's cape download (src/main/cape-download.js): it must fetch a cape from a server that
 * sends no CORS header - which is what the live CDN does, and why the page could not - and it must
 * refuse anything that is not one of the API's own cape files.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { downloadCape, isCapeUrl, MAX_CAPE_DOWNLOAD } from '../src/main/cape-download.js'

const SHA = 'ab'.repeat(32)
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
let server
let base

before(async () => {
  server = http.createServer((req, res) => {
    // Like Caddy's file_server on the live /cdn: no Access-Control-Allow-Origin at all.
    if (req.url === `/cdn/capes/ab/${SHA}.png`) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PNG)
    }
    if (req.url === `/cdn/capes/cd/${'cd'.repeat(32)}.png`) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(Buffer.alloc(MAX_CAPE_DOWNLOAD + 10))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

describe('cape download', () => {
  it('only accepts the API\'s own cape paths', () => {
    const api = 'https://api.enderphone.cloud'
    assert.equal(isCapeUrl(`${api}/cdn/capes/ab/${SHA}.png`, api), true)
    assert.equal(isCapeUrl(`${api}/cdn/capes/ab/${SHA}.gif`, api), true)
    assert.equal(isCapeUrl(`https://evil.example/cdn/capes/ab/${SHA}.png`, api), false)
    assert.equal(isCapeUrl(`${api}/cdn/photos/ab/${SHA}.png`, api), false)
    assert.equal(isCapeUrl(`${api}/cdn/capes/ab/${SHA}.png?x=1`, api), false)
    assert.equal(isCapeUrl(`${api}/cdn/capes/../../v1/me`, api), false)
    assert.equal(isCapeUrl('not a url', api), false)
  })

  it('downloads a cape from a CDN that sends no CORS header', async () => {
    const got = await downloadCape(`${base}/cdn/capes/ab/${SHA}.png`, base)
    assert.equal(got.type, 'image/png')
    assert.deepEqual(Buffer.from(got.base64, 'base64'), PNG)
  })

  it('says why when the file is missing', async () => {
    await assert.rejects(downloadCape(`${base}/cdn/capes/ef/${'ef'.repeat(32)}.png`, base), /404/)
  })

  it('refuses a file far bigger than any cape', async () => {
    await assert.rejects(downloadCape(`${base}/cdn/capes/cd/${'cd'.repeat(32)}.png`, base), /too large/)
  })

  it('refuses a URL off the API', async () => {
    await assert.rejects(downloadCape(`${base}/v1/me`, base), /not an EnderPhone cape/)
  })
})
