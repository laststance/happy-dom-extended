import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { BroadcastChannel, MessageChannel } from 'node:worker_threads';

import { Window } from 'happy-dom';

import { installCompatibility } from '../src/index.ts';

/** Gives each regression test an independently disposed Happy DOM environment.
 * @param context - Node test lifecycle used for guaranteed cleanup.
 * @returns A window with installed compatibility extensions.
 * @example const window = await createWindow(context);
 */
async function createWindow(context: TestContext): Promise<Window> {
  const window = new Window();
  const dispose = installCompatibility(window);
  context.after(async () => {
    dispose();
    await window.happyDOM.close();
  });
  return window;
}

test('binary File input keeps its bytes instead of becoming an ArrayBuffer label', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const input = new window.Uint8Array([65, 66]);
  // Act
  const file = new window.File([input.buffer], 'sample.txt');
  // Assert
  assert.equal(file.size, 2);
  assert.equal(await file.text(), 'AB');
  assert.equal(file instanceof window.Blob, true);
  assert.equal(file instanceof window.File, true);
});

test('Blob parts preserve view offsets, nested Files, and sliced Blob identity', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const bytes = new window.Uint8Array([0, 65, 66, 0]);
  const file = new window.File([bytes.subarray(1, 3)], 'sample.txt');
  // Act
  const blob = new window.Blob([file, '!']);
  const slice = blob.slice(1);
  // Assert
  assert.equal(await blob.text(), 'AB!');
  assert.equal(await slice.text(), 'B!');
  assert.equal(slice instanceof window.Blob, true);
});

test('Blob UTF-8 text consumes one leading BOM but preserves an interior BOM', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const blob = new window.Blob(['\uFEFFA\uFEFFB']);
  // Act
  const text = await blob.text();
  // Assert
  assert.equal(text, 'A\uFEFFB');
  assert.deepEqual(
    [...new Uint8Array(await blob.arrayBuffer())],
    [239, 187, 191, 65, 239, 187, 191, 66],
  );
});

test('Blob text replaces malformed UTF-8 and bytes returns independently mutable copies', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const blob = new window.Blob([new window.Uint8Array([255, 65])]);
  const bytesMethod: () => Promise<Uint8Array> = Reflect.get(
    blob,
    'bytes',
  ).bind(blob);
  // Act
  const bytes = await bytesMethod();
  bytes[1] = 66;
  // Assert
  assert.equal(await blob.text(), '\uFFFDA');
  assert.deepEqual([...(await bytesMethod())], [255, 65]);
});

test('FileReader still accepts the extended Blob family and produces the actual data URL', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const file = new window.File(
    [new window.Uint8Array([65, 66]).buffer],
    'sample.txt',
    { type: 'text/plain' },
  );
  const reader = new window.FileReader();
  // Act
  const result = new Promise<unknown>((resolve, reject) => {
    reader.addEventListener('load', () => resolve(reader.result), {
      once: true,
    });
    reader.addEventListener('error', () => reject(reader.error), {
      once: true,
    });
    reader.readAsDataURL(file);
  });
  // Assert
  assert.equal(await result, 'data:text/plain;base64,QUI=');
});

test('ImageData accepts VM pixels and preserves both object identity and shared pixel storage', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const pixels = new window.Uint8ClampedArray([255, 0, 0, 255]);
  // Act
  const image = new window.ImageData(pixels, 1, 1);
  pixels[1] = 64;
  // Assert
  assert.equal(image.data, pixels);
  assert.deepEqual([...image.data], [255, 64, 0, 255]);
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.equal(image instanceof window.ImageData, true);
});

test('ImageData preserves subarray offsets and its existing numeric constructor', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const pixels = new window.Uint8ClampedArray([9, 9, 9, 9, 10, 20, 30, 40]);
  // Act
  const image = new window.ImageData(pixels.subarray(4), 1);
  const blank = new window.ImageData(2, 1);
  // Assert
  assert.deepEqual([...image.data], [10, 20, 30, 40]);
  assert.equal(image.height, 1);
  assert.deepEqual([...blank.data], [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('XHR consumers can compare instance readyState against all five standard constants', async (context) => {
  // Arrange
  const window = await createWindow(context);
  // Act
  const request = new window.XMLHttpRequest();
  // Assert
  assert.equal(Reflect.get(request, 'UNSENT'), 0);
  assert.equal(Reflect.get(request, 'OPENED'), 1);
  assert.equal(Reflect.get(request, 'HEADERS_RECEIVED'), 2);
  assert.equal(Reflect.get(request, 'LOADING'), 3);
  assert.equal(Reflect.get(request, 'DONE'), 4);
  assert.equal(request.readyState, Reflect.get(request, 'UNSENT'));
  assert.equal(Reflect.set(request, 'DONE', 5), false);
});

test('canceling animation keeps AbortError observable without an unhandled rejection', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const animation = new window.Animation();
  animation.play();
  const finished = animation.finished;
  // Act
  animation.cancel();
  // Assert
  await assert.rejects(finished, { name: 'AbortError' });
  assert.equal(animation.playState, 'idle');
  animation.play();
  animation.cancel();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test(
  'MessageChannel transfers data through entangled native ports',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const window = await createWindow(context);
    const Constructor: typeof MessageChannel = Reflect.get(
      window,
      'MessageChannel',
    );
    const channel = new Constructor();
    const received = once(channel.port2, 'message');
    // Act
    channel.port1.postMessage({ count: 3 });
    // Assert
    assert.deepEqual(await received, [{ count: 3 }]);
    assert.equal(
      channel.port1 instanceof Reflect.get(window, 'MessagePort'),
      true,
    );
  },
);

test(
  'BroadcastChannel delivers data to a same-name peer and retains the public name',
  { timeout: 2000 },
  async (context) => {
    // Arrange
    const window = await createWindow(context);
    const Constructor: typeof BroadcastChannel = Reflect.get(
      window,
      'BroadcastChannel',
    );
    const sender = new Constructor('updates');
    const receiver = new Constructor('updates');
    const received = new Promise<unknown>((resolve) => {
      receiver.onmessage = (event) => resolve(event.data);
    });
    // Act
    sender.postMessage({ count: 3 });
    // Assert
    assert.deepEqual(await received, { count: 3 });
    assert.equal(sender.name, 'updates');
  },
);

test('disposing one environment does not remove shared Blob methods from another active environment', async (context) => {
  // Arrange
  const first = new Window();
  const second = new Window();
  const disposeFirst = installCompatibility(first);
  const disposeSecond = installCompatibility(second);
  context.after(async () => {
    disposeFirst();
    disposeSecond();
    await first.happyDOM.close();
    await second.happyDOM.close();
  });
  // Act
  disposeFirst();
  // Assert
  assert.equal(await new second.Blob(['\uFEFFA']).text(), 'A');
  assert.equal(typeof Reflect.get(second.Blob.prototype, 'bytes'), 'function');
});

test('teardown restores constructors and prototype methods and closes forgotten channels', async () => {
  // Arrange
  const window = new Window();
  const originalBlob = window.Blob;
  const originalText = window.Blob.prototype.text;
  const originalCancel = window.Animation.prototype.cancel;
  const dispose = installCompatibility(window);
  const Constructor: typeof BroadcastChannel = Reflect.get(
    window,
    'BroadcastChannel',
  );
  const channel = new Constructor('forgotten');
  // Act
  dispose();
  dispose();
  // Assert
  assert.equal(window.Blob, originalBlob);
  assert.equal(window.Blob.prototype.text, originalText);
  assert.equal(window.Animation.prototype.cancel, originalCancel);
  assert.equal(Reflect.get(window, 'BroadcastChannel'), undefined);
  assert.throws(() => channel.postMessage('closed'));
  await window.happyDOM.close();
});

test('disposing an earlier environment before awaiting the next installation preserves BOM decoding', async (context) => {
  // Arrange
  const first = new Window();
  const second = new Window();
  const disposeFirst = await Promise.resolve(installCompatibility(first));
  const installingSecond = Promise.resolve(installCompatibility(second));
  context.after(async () => {
    disposeFirst();
    (await installingSecond)();
    await first.happyDOM.close();
    await second.happyDOM.close();
  });
  // Act
  disposeFirst();
  await installingSecond;
  // Assert
  assert.equal(await new second.Blob(['\uFEFFA']).text(), 'A');
});

test('failed setup restores earlier global replacements before reporting the error', async () => {
  // Arrange
  const window = new Window();
  const originalPort = window.MessagePort;
  Object.defineProperty(window, 'MessageChannel', {
    value: undefined,
    configurable: false,
  });
  // Act / Assert
  assert.throws(() => installCompatibility(window), TypeError);
  assert.equal(Reflect.get(window, 'structuredClone'), undefined);
  assert.equal(Reflect.get(window, 'BroadcastChannel'), undefined);
  assert.equal(window.MessagePort, originalPort);
  await window.happyDOM.close();
});

test('existing native global implementations retain their identity', async () => {
  // Arrange
  const window = new Window();
  const nativeClone = globalThis.structuredClone;
  Object.defineProperty(window, 'structuredClone', {
    value: nativeClone,
    configurable: true,
  });
  // Act
  const dispose = installCompatibility(window);
  // Assert
  assert.equal(Reflect.get(window, 'structuredClone'), nativeClone);
  dispose();
  assert.equal(Reflect.get(window, 'structuredClone'), nativeClone);
  await window.happyDOM.close();
});

test('failed installation restores its window while preserving another environment Blob readers', async (context) => {
  // Arrange
  const active = new Window();
  const failing = new Window();
  const disposeActive = installCompatibility(active);
  const originalBlob = failing.Blob;
  context.after(async () => {
    disposeActive();
    await active.happyDOM.close();
    await failing.happyDOM.close();
  });
  Object.defineProperty(failing, 'CompositionEvent', {
    value: failing.CompositionEvent,
    configurable: false,
  });
  // Act / Assert
  assert.throws(() => installCompatibility(failing), TypeError);
  assert.equal(failing.Blob, originalBlob);
  assert.equal(Reflect.get(failing, 'structuredClone'), undefined);
  assert.equal(Reflect.get(failing, 'BroadcastChannel'), undefined);
  assert.equal(await new active.Blob(['\uFEFFA']).text(), 'A');
});

test('composition events dispatch IME text through Happy DOM UIEvent with a read-only payload', async (context) => {
  // Arrange
  const window = await createWindow(context);
  const event = Reflect.construct(window.CompositionEvent, [
    'compositionend',
    { data: '日本語', bubbles: true, detail: 2 },
  ]);
  const input = window.document.createElement('input');
  let received: unknown;
  input.addEventListener('compositionend', (receivedEvent) => {
    received = Reflect.get(receivedEvent, 'data');
  });
  // Act
  input.dispatchEvent(event);
  // Assert
  assert.equal(received, '日本語');
  assert.ok(event instanceof window.UIEvent);
  assert.equal(event.detail, 2);
  assert.equal(event.bubbles, true);
  assert.equal(Reflect.set(event, 'data', 'replaced'), false);
  assert.equal(
    Reflect.get(
      Reflect.construct(window.CompositionEvent, ['compositionstart']),
      'data',
    ),
    '',
  );
});
