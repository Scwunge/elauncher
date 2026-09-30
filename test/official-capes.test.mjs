/**
 * The account's official capes (src/main/official-capes.js): read from Mojang's profile, switched
 * with its capes/active endpoint, and each texture fetched only from Mojang's texture CDN. The
 * `fetchImpl` stands in for Mojang, so nothing here touches the network.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { downloadCapeTexture, listOfficialCapes, parseCapes, setActiveCape } from '../src/main/official-capes.js'

const PAN = '28de4a81688ad18b49e735a273e086c18f1e3966956123ccb574034c06f5d336'
const MIGRATOR = '2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933'
const PROFILE = {
  id: 'abc', name: 'Alex',
  capes: [
    { id: '11111111-2222-3333-4444-555555555555', state: 'ACTIVE', url: `http://textures.minecraft.net/texture/${MIGRATOR}`, alias: 'Migrator' },
    { id: '66666666-7777-8888-9999-000000000000', state: 'INACTIVE', url: `http://textures.minecraft.net/texture/${PAN}`, alias: 'Pan' },
    { id: 'bad', state: 'INACTIVE', url: 'https://evil.example/cape.png', alias: 'Not a texture' },
  ],
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('official capes', () => {
  it('reads the owned capes, the worn one marked, and skips anything that is not a Mojang texture', () => {
    assert.deepEqual(parseCapes(PROFILE), [
      { id: '11111111-2222-3333-4444-555555555555', name: 'Migrator', texture: MIGRATOR, active: true },
      { id: '66666666-7777-8888-9999-000000000000', name: 'Pan', texture: PAN, active: false },
    ])
    assert.deepEqual(parseCapes({}), [])
  })

  it('asks Mojang with the account token', async () => {
    let seen
    const capes = await listOfficialCapes('mc-token', async (url, init) => { seen = { url, auth: init.headers.Authorization }; return json(PROFILE) })
    assert.equal(seen.url, 'https://api.minecraftservices.com/minecraft/profile')
    assert.equal(seen.auth, 'Bearer mc-token')
    assert.equal(capes.length, 2)
    await assert.rejects(listOfficialCapes('t', async () => json({}, 401)), /didn't return your capes \(401\)/)
  })

  it('wears a cape with PUT, none with DELETE, and returns the list Mojang answers with', async () => {
    const calls = []
    const fake = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body })
      const worn = init.method === 'PUT' ? JSON.parse(init.body).capeId : null
      return json({ ...PROFILE, capes: PROFILE.capes.map((c) => ({ ...c, state: c.id === worn ? 'ACTIVE' : 'INACTIVE' })) })
    }
    const after = await setActiveCape('t', '66666666-7777-8888-9999-000000000000', fake)
    assert.equal(calls[0].url, 'https://api.minecraftservices.com/minecraft/profile/capes/active')
    assert.equal(calls[0].method, 'PUT')
    assert.deepEqual(JSON.parse(calls[0].body), { capeId: '66666666-7777-8888-9999-000000000000' })
    assert.equal(after.find((c) => c.active)?.texture, PAN)
    const none = await setActiveCape('t', null, fake)
    assert.equal(calls[1].method, 'DELETE')
    assert.equal(none.some((c) => c.active), false)
    await assert.rejects(setActiveCape('t', '../../x', fake), /not a cape on this account/)
    assert.equal(calls.length, 2, 'a bad id never reaches Mojang')
  })

  it('downloads a texture only from textures.minecraft.net, only a PNG', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)])
    let asked
    const got = await downloadCapeTexture(PAN, async (url) => { asked = url; return new Response(png, { status: 200 }) })
    assert.equal(asked, `https://textures.minecraft.net/texture/${PAN}`)
    assert.equal(got.type, 'image/png')
    assert.equal(Buffer.from(got.base64, 'base64').length, png.length)
    await assert.rejects(downloadCapeTexture('https://evil.example/x', async () => new Response(png)), /not a cape texture/)
    await assert.rejects(downloadCapeTexture(PAN, async () => new Response('<html>')), /not a cape texture/)
  })
})
