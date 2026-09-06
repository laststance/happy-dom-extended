const assert = require('node:assert/strict');
const { setTimeout, clearTimeout } = require('node:timers');

// Application imports can construct these APIs before Jest calls environment.setup().
const channel = new BroadcastChannel('setup-regression');
channel.close();
const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
assert.equal(new ImageData(pixels, 1, 1).data, pixels);
assert.equal(new CompositionEvent('compositionend', { data: 'あ' }).data, 'あ');
assert.equal(new XMLHttpRequest().DONE, 4);

/** Reads binary application data while Jest is still evaluating setupFiles.
 * @returns Resolves after setup-time Blob behavior is verified.
 * @example module.exports();
 */
module.exports = async () => {
  // Arrange
  const file = new File([new Uint8Array([65, 66]).buffer], 'setup.txt');
  const blob = new Blob(['\uFEFFA']);
  // Act
  const fileText = await file.text();
  const blobText = await blob.text();
  // Assert
  assert.equal(file.size, 2);
  assert.equal(fileText, 'AB');
  assert.equal(blobText, 'A');

  // The receiving port must keep asynchronous setup alive until its message arrives.
  const messages = new MessageChannel();
  const received = new Promise((resolve) => {
    messages.port2.onmessage = (event) => resolve(event.data);
  });
  const timer = setTimeout(() => messages.port1.postMessage('setup-ready'), 25);
  timer.unref();
  try {
    assert.equal(await received, 'setup-ready');
  } finally {
    clearTimeout(timer);
    messages.port1.close();
    messages.port2.close();
  }
};
