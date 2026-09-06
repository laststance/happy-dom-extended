import { expect, test } from '@jest/globals';

test('Jest setup exposes structured cloning with cycles, Maps, Dates, and transferable buffers', () => {
  // Arrange
  const value: { count: number; self?: unknown } = { count: 3 };
  value.self = value;
  const buffer = new Uint8Array([65, 66]).buffer;
  // Act
  const clone = structuredClone(value);
  const map = structuredClone(new Map([['answer', 42]]));
  const date = structuredClone(new Date('2026-01-01T00:00:00Z'));
  const transferred = structuredClone(buffer, { transfer: [buffer] });
  // Assert
  expect(clone).not.toBe(value);
  expect(clone.self).toBe(clone);
  expect(map.get('answer')).toBe(42);
  expect(date.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  expect([...new Uint8Array(transferred)]).toEqual([65, 66]);
  expect(buffer.byteLength).toBe(0);
});

test('File upload tests retain binary contents and FileReader compatibility inside the Jest VM', async () => {
  // Arrange
  const file = new File([new Uint8Array([65, 66]).buffer], 'upload.txt');
  const reader = new FileReader();
  // Act
  const text = new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  // Assert
  expect(file.size).toBe(2);
  expect(file).toBeInstanceOf(Blob);
  expect(await text).toBe('AB');
  expect(await new Blob(['\uFEFFcsv']).text()).toBe('csv');
});

test('encoding streams preserve Unicode across a byte-stream round trip', async () => {
  // Arrange
  const input = new ReadableStream<string>({
    start(controller) {
      controller.enqueue('Hello 日本語 🌸');
      controller.close();
    },
  });
  // Act
  const reader = input
    .pipeThrough(new TextEncoderStream())
    .pipeThrough(new TextDecoderStream())
    .getReader();
  // Assert
  expect(await reader.read()).toEqual({
    done: false,
    value: 'Hello 日本語 🌸',
  });
  expect(await reader.read()).toEqual({ done: true, value: undefined });
});

test('compression streams perform a real gzip round trip', async () => {
  // Arrange
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('round trip'));
      controller.close();
    },
  });
  // Act
  const reader = input
    .pipeThrough(new CompressionStream('gzip'))
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let decoded = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    decoded += chunk.value;
  }
  // Assert
  expect(decoded).toBe('round trip');
});

test('ImageData reads typed-array pixels allocated by Jest without changing their identity', () => {
  // Arrange
  const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
  // Act
  const image = new ImageData(pixels, 1, 1);
  // Assert
  expect(image.data).toBe(pixels);
  expect([...image.data]).toEqual([255, 0, 0, 255]);
});

test('XHR ready-state comparisons work on instances in consumer code', () => {
  // Arrange
  const request = new XMLHttpRequest();
  // Act
  const isUnsent = request.readyState === request.UNSENT;
  // Assert
  expect(isUnsent).toBe(true);
  expect(request.DONE).toBe(4);
});

test('native MessageChannel delivers messages and has matching MessagePort identity', async () => {
  // Arrange
  const channel = new MessageChannel();
  const message = new Promise((resolve) => {
    channel.port2.onmessage = (event) => resolve(event.data);
  });
  // Act
  channel.port1.postMessage('ready');
  // Assert
  expect(channel.port1).toBeInstanceOf(MessagePort);
  expect(await message).toBe('ready');
  channel.port1.close();
  channel.port2.close();
});

test('BroadcastChannel supports real peer delivery and environment-owned cleanup', async () => {
  // Arrange
  const sender = new BroadcastChannel('events');
  const receiver = new BroadcastChannel('events');
  const message = new Promise((resolve) => {
    receiver.onmessage = (event) => resolve(event.data);
  });
  // Act
  sender.postMessage({ updated: true });
  // Assert
  expect(await message).toEqual({ updated: true });
  expect(sender.name).toBe('events');
});

test('animation cancellation exposes AbortError and tolerates consumers ignoring finished', async () => {
  // Arrange
  const animation = new Animation();
  animation.play();
  const finished = animation.finished;
  // Act
  animation.cancel();
  // Assert
  await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
  animation.play();
  animation.cancel();
});

test('composition input carries its text and existing geometry constructors keep working', () => {
  // Arrange
  const event = new CompositionEvent('compositionend', { data: 'あ' });
  // Act
  const point = new DOMPoint(2, 3);
  // Assert
  expect(event.data).toBe('あ');
  expect(event).toBeInstanceOf(UIEvent);
  expect(point.x).toBe(2);
  expect(point.y).toBe(3);
});
