/** Quick Play: which versions take --quickPlay* arguments and which need the old --server/--port. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { supportsQuickPlay } from '../src/main/minecraft.js'

describe('supportsQuickPlay', () => {
  it('is on from 1.20 and for every year-numbered release', () => {
    for (const v of ['1.20', '1.20.1', '1.21.1', '26.1.2', '26.2', '26.3']) assert.equal(supportsQuickPlay(v), true, v)
  })
  it('is off before 1.20', () => {
    for (const v of ['1.19.4', '1.16.5', '1.8.9']) assert.equal(supportsQuickPlay(v), false, v)
  })
})
