import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import Environment from 'jest-happy-dom-extended';
import { installCanvasStub } from 'jest-happy-dom-extended/canvas';

const require = createRequire(import.meta.url);
const CommonJSEnvironment = require('jest-happy-dom-extended');
assert.equal(typeof Environment, 'function');
assert.equal(typeof CommonJSEnvironment, 'function');
assert.equal(typeof installCanvasStub, 'function');
process.stdout.write('ESM and CommonJS package exports loaded successfully.\n');
