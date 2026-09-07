import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { PNG } from 'pngjs'

import { renderingWindow } from './utils/rendering-window.ts'

test(
  'an HTML placeholder presents actual Offscreen pixels and preserves its attribute dimensions independently of the bitmap',
  { timeout: 4000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const html = window.document.createElement('canvas')
    html.width = 1
    html.height = 1
    const offscreen = html.transferControlToOffscreen()
    const drawing = offscreen.getContext('2d')!
    assert.throws(() => html.getContext('2d'), { name: 'InvalidStateError' })
    assert.throws(() => html.transferControlToOffscreen(), {
      name: 'InvalidStateError',
    })
    assert.throws(
      () => {
        html.width = 2
      },
      { name: 'InvalidStateError' },
    )
    // Act
    Reflect.set(offscreen, 'width', 2)
    drawing.fillStyle = 'red'
    drawing.fillRect(0, 0, 2, 1)
    let png = PNG.sync.read(
      Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
    )
    for (let attempt = 0; attempt < 100 && png.width !== 2; attempt += 1) {
      await setTimeout(10)
      png = PNG.sync.read(
        Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
      )
    }
    html.setAttribute('width', '5')
    html.getAttributeNode('width')!.value = '6'
    const copied = new window.OffscreenCanvas(2, 1).getContext('2d')!
    copied.drawImage(html, 0, 0)
    // Assert
    assert.equal(html.width, 6)
    assert.equal(png.width, 2)
    assert.deepEqual([...png.data], [255, 0, 0, 255, 255, 0, 0, 255])
    assert.deepEqual(
      [...copied.getImageData(0, 0, 2, 1).data],
      [255, 0, 0, 255, 255, 0, 0, 255],
    )
  },
)

test(
  'a Worker updates the original HTML placeholder after transfer with actual independently decoded blue pixels',
  { timeout: 8000 },
  async (context) => {
    // Arrange
    const { window } = await renderingWindow(context)
    const Constructor = Reflect.get(window, 'Worker')
    const source = `onmessage = ({data: canvas}) => {
    const drawing = canvas.getContext('2d'); drawing.fillStyle = 'blue';
    drawing.fillRect(0, 0, 1, 1); postMessage('drawn');
  }`
    const worker = new Constructor(
      `data:text/javascript,${encodeURIComponent(source)}`,
    )
    const drawn = new Promise<void>((resolve, reject) => {
      worker.onmessage = () => resolve()
      worker.onerror = (event: { message: string }) =>
        reject(new Error(event.message))
    })
    const html = window.document.createElement('canvas')
    html.width = 1
    html.height = 1
    const offscreen = html.transferControlToOffscreen()
    // Act
    worker.postMessage(offscreen, [offscreen])
    await drawn
    let png = PNG.sync.read(
      Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
    )
    for (let attempt = 0; attempt < 100 && png.data[2] !== 255; attempt += 1) {
      await setTimeout(10)
      png = PNG.sync.read(
        Buffer.from(html.toDataURL().split(',')[1]!, 'base64'),
      )
    }
    // Assert
    assert.equal(offscreen.width, 0)
    assert.deepEqual([...png.data], [0, 0, 255, 255])
    assert.throws(() => html.getContext('2d'), { name: 'InvalidStateError' })
    worker.terminate()
  },
)
