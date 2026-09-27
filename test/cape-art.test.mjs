/**
 * The cape texture builder (src/renderer/src/cape-art.ts) against the mod's own CapeArt.java.
 *
 * The expected hashes were produced by running enderphone-core's CapeArt.compose (Java 21) on the
 * same generated pictures - so this proves the launcher's preview is byte-for-byte the texture the
 * game draws, not just "close". If CapeArt.java changes, regenerate them the same way: a Java main
 * that builds these pictures with this generator and prints sha256 of compose()'s ARGB output
 * (big-endian).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { average, compose, height, scaleFor, shade, width } from '../src/renderer/src/cape-art.ts'

/** The Java test's LCG and picture maker, line for line. */
function picture(w, h, seed) {
  let s = seed
  const next = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff)
  const px = new Int32Array(w * h)
  for (let i = 0; i < px.length; i++) {
    let a = (next() >> 8) & 0xff
    if (a < 60) a = 0
    else if (a > 200) a = 255
    const r = (next() >> 8) & 0xff
    const g = (next() >> 8) & 0xff
    const b = (next() >> 8) & 0xff
    px[i] = (a << 24) | (r << 16) | (g << 8) | b
  }
  return px
}

function sha256(argb) {
  const buf = Buffer.alloc(argb.length * 4)
  for (let i = 0; i < argb.length; i++) buf.writeInt32BE(argb[i], i * 4)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

const GOLDEN = [
  // [w, h, animated, seed, scale, sha256 of CapeArt.java's output]
  [37, 53, false, 1, 4, 'c986824b094e31db2c383cc4d34debf72d5c4b22dbedc925b5e6757d42f299e0'],
  [512, 512, false, 2, 8, '8be187d6161a5e53769db6ea1b25403cd2445c27af9b378549aefe03a413ac2e'],
  [1024, 300, false, 3, 8, 'ddaa57e9eef36032a72f7bc02b1d822240214d3162039eb65ccca3d2ff5a41b6'],
  [10, 16, false, 4, 1, '38e6fce79dee5691342678b309f173460a8410ff5ba354480c1d5aa0670654ac'],
  [3, 3, false, 5, 1, 'cf3e3ffe8f3d40decb3c7363086cb25c7d08e4777d43c7311eb6f7d5d4400fcc'],
  [128, 64, true, 6, 4, '866cfc5a07ccf68d982da4b876a1251926c3c59c8917ec004f2cfccd4c395235'],
  [64, 32, false, 7, 7, 'c3aaf0d6cd95a0d1237eaf662555c39653abd0c3de4d65707d415dd7165b1541'],
]

describe('cape texture (port of CapeArt.java)', () => {
  for (const [w, h, animated, seed, scale, expected] of GOLDEN) {
    it(`${w}x${h}${animated ? ' animated' : ''} matches the mod byte for byte`, () => {
      assert.equal(scaleFor(w, h, animated), scale)
      const out = compose(picture(w, h, seed), w, h, scale)
      assert.equal(out.length, width(scale) * height(scale))
      assert.equal(sha256(out), expected)
    })
  }

  it('caps the scale: 8 for a still, 4 for an animation', () => {
    assert.equal(scaleFor(1024, 1024, false), 8)
    assert.equal(scaleFor(1024, 1024, true), 4)
    assert.equal(scaleFor(5, 5, false), 1)
  })

  it('fills every face opaque, even for a fully transparent picture', () => {
    const out = compose(new Int32Array(4 * 4), 4, 4, 1)
    const at = (x, y) => out[y * 64 + x] >>> 24
    assert.equal(at(1, 1), 0xff, 'cape outer face')
    assert.equal(at(24, 2), 0xff, 'elytra wing')
    assert.equal(at(63, 31), 0, 'unused area stays transparent')
    assert.equal(average(new Int32Array(4)) | 0, 0xff808080 | 0, 'no visible pixels: mid grey')
  })

  it('darkens by rounding the way Java does', () => {
    assert.equal(shade(0xffffffff | 0, Math.fround(0.7)) >>> 0, 0xffb3b3b3)
  })
})
