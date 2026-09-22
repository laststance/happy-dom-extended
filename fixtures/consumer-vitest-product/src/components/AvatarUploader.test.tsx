import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { AvatarUploader } from '@/components/AvatarUploader'
import { createPngFile, readPixel } from '@/test/canvas'

test('uploading a PNG avatar previews the image and shows its pixel size', async () => {
  // Arrange
  const user = userEvent.setup()
  const avatar = await createPngFile(3, 2, 'rgb(255, 0, 0)')
  render(<AvatarUploader />)
  // Act
  await user.upload(screen.getByLabelText('Avatar'), avatar)
  // Assert
  expect(await screen.findByText('3 × 2 px')).toBeVisible()
  expect(
    readPixel(screen.getByRole('img', { name: 'Avatar preview' }), 1, 1),
  ).toEqual([255, 0, 0, 255])
})
