import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { AccountMenu } from '@/components/AccountMenu'

test('signing out in another tab signs this tab out too', async () => {
  // Arrange
  const otherTab = new BroadcastChannel('auth')
  render(<AccountMenu userName="Raphtalia" />)
  expect(screen.getByText('Signed in as Raphtalia')).toBeVisible()
  try {
    // Act
    otherTab.postMessage('signed-out')
    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You signed out in another tab.',
    )
  } finally {
    otherTab.close()
  }
})

test('Sign out everywhere tells the other open tabs while this tab keeps its menu', async () => {
  // Arrange
  const user = userEvent.setup()
  const otherTab = new BroadcastChannel('auth')
  const received = new Promise<unknown>((resolve) => {
    otherTab.onmessage = (event: MessageEvent<unknown>) => resolve(event.data)
  })
  render(<AccountMenu userName="Raphtalia" />)
  try {
    // Act
    await user.click(
      screen.getByRole('button', { name: 'Sign out everywhere' }),
    )
    // Assert
    expect(await received).toBe('signed-out')
    expect(screen.getByText('Signed in as Raphtalia')).toBeVisible()
  } finally {
    otherTab.close()
  }
})
