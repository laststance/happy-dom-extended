import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

import ESMEnvironment from 'jest-happy-dom-extended'

const require = createRequire(import.meta.url)
const CommonJSEnvironment = require('jest-happy-dom-extended')
const configuration = {
  globalConfig: {},
  projectConfig: {
    globals: {},
    testEnvironmentOptions: {},
    fakeTimers: {},
    rootDir: process.cwd(),
  },
}

for (const { label, constructors } of [
  { label: 'ESM first', constructors: [ESMEnvironment, CommonJSEnvironment] },
  {
    label: 'CommonJS first',
    constructors: [CommonJSEnvironment, ESMEnvironment],
  },
]) {
  for (const closingIndex of [0, 1]) {
    test(`Blob readers survive mixed module teardown (${label}, close environment ${closingIndex + 1})`, async () => {
      // Arrange
      const activeEnvironments = []
      try {
        for (const Environment of constructors) {
          activeEnvironments.push(new Environment(configuration, { console }))
        }

        // Act
        const [closingEnvironment] = activeEnvironments.splice(closingIndex, 1)
        await closingEnvironment.teardown()
        const [remainingEnvironment] = activeEnvironments
        const blob = new remainingEnvironment.window.Blob(['\uFEFFA'])
        const file = new remainingEnvironment.window.File(
          ['\uFEFFB'],
          'bom.txt',
        )

        // Assert
        assert.equal(await blob.text(), 'A')
        assert.deepEqual([...(await blob.bytes())], [239, 187, 191, 65])
        assert.equal(await file.text(), 'B')
        assert.deepEqual([...(await file.bytes())], [239, 187, 191, 66])
      } finally {
        for (const environment of activeEnvironments) {
          await environment.teardown()
        }
      }
    })
  }
}
