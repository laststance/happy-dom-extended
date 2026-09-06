/** @jest-environment-options {"url":"https://example.test/settings?mode=test"} */
import { expect, test } from '@jest/globals';

test('standard Happy DOM environment options still configure the test document URL', () => {
  // Arrange
  const expectedUrl = 'https://example.test/settings?mode=test';
  // Act
  const actualUrl = window.location.href;
  // Assert
  expect(actualUrl).toBe(expectedUrl);
});
