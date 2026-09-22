import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test } from 'vitest'

import { SalesChart } from '@/components/SalesChart'
import { readImagePixel, readPixel } from '@/test/canvas'

test('the sales chart draws each month as a bar scaled to the best month', () => {
  // Arrange / Act
  render(<SalesChart monthlySales={[50, 100]} barColor="rgb(0, 128, 0)" />)
  // Assert
  const chart = screen.getByRole('img', { name: 'Monthly sales' })
  expect(chart).toBeVisible()
  expect(readPixel(chart, 10, 5)).toEqual([0, 0, 0, 0])
  expect(readPixel(chart, 10, 15)).toEqual([0, 128, 0, 255])
  expect(readPixel(chart, 30, 5)).toEqual([0, 128, 0, 255])
})

test('Export PNG offers a sales.png download that contains the drawn chart', async () => {
  // Arrange
  const user = userEvent.setup()
  render(<SalesChart monthlySales={[100]} barColor="rgb(0, 0, 255)" />)
  // Act
  await user.click(screen.getByRole('button', { name: 'Export PNG' }))
  // Assert
  const download = await screen.findByRole('link', {
    name: 'Download sales.png',
  })
  expect(download).toBeVisible()
  expect(download).toHaveAttribute('download', 'sales.png')
  expect(
    await readImagePixel(download.getAttribute('href') ?? '', 20, 10),
  ).toEqual([0, 0, 255, 255])
})
