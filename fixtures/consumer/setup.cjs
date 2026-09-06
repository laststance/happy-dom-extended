const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const { setTimeout, clearTimeout } = require('node:timers')

const { PNG } = require('pngjs')

// The tarball verifier checks actual process identities, not just requested CLI worker options.
if (process.env.HAPPY_DOM_WORKER_RECORD_DIRECTORY) {
  writeFileSync(
    path.join(
      process.env.HAPPY_DOM_WORKER_RECORD_DIRECTORY,
      `${process.pid}.json`,
    ),
    JSON.stringify({ pid: process.pid }),
  )
}

// Application imports can construct these APIs before Jest calls environment.setup().
const channel = new BroadcastChannel('setup-regression')
channel.close()
const pixels = new Uint8ClampedArray([255, 0, 0, 255])
assert.equal(new ImageData(pixels, 1, 1).data, pixels)
assert.equal(new CompositionEvent('compositionend', { data: 'あ' }).data, 'あ')
assert.equal(new XMLHttpRequest().DONE, 4)
const canvas = document.createElement('canvas')
canvas.width = 1
canvas.height = 1
const drawing = canvas.getContext('2d')
assert.ok(drawing)
drawing.putImageData(new ImageData(pixels, 1, 1), 0, 0)
assert.deepEqual([...drawing.getImageData(0, 0, 1, 1).data], [255, 0, 0, 255])

/** Reads binary application data while Jest is still evaluating setupFiles.
 * @returns Resolves after setup-time Blob behavior is verified.
 * @example module.exports();
 */
module.exports = async () => {
  const output = await new Promise((resolve) => canvas.toBlob(resolve))
  assert.ok(output instanceof Blob)
  const decoded = PNG.sync.read(Buffer.from(await output.arrayBuffer()))
  assert.equal(decoded.width, 1)
  assert.equal(decoded.height, 1)
  assert.deepEqual([...decoded.data], [255, 0, 0, 255])
  // Arrange
  const file = new File([new Uint8Array([65, 66]).buffer], 'setup.txt')
  const blob = new Blob(['\uFEFFA'])
  // Act
  const fileText = await file.text()
  const blobText = await blob.text()
  // Assert
  assert.equal(file.size, 2)
  assert.equal(fileText, 'AB')
  assert.equal(blobText, 'A')

  // The receiving port must keep asynchronous setup alive until its message arrives.
  const messages = new MessageChannel()
  const received = new Promise((resolve) => {
    messages.port2.onmessage = (event) => resolve(event.data)
  })
  const timer = setTimeout(() => messages.port1.postMessage('setup-ready'), 25)
  timer.unref()
  try {
    assert.equal(await received, 'setup-ready')
  } finally {
    clearTimeout(timer)
    messages.port1.close()
    messages.port2.close()
  }
}
