import { fireEvent, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'

import { SearchBox } from '@/components/SearchBox'

beforeEach(() => {
  localStorage.clear()
})

test('the Enter that confirms a Japanese IME conversion does not search until the user presses Enter again', async () => {
  // Arrange
  const user = userEvent.setup()
  const onSearch = vi.fn()
  render(<SearchBox onSearch={onSearch} />)
  const input = screen.getByRole('searchbox', { name: 'Search products' })
  await user.click(input)
  // Act
  fireEvent.compositionStart(input, { data: '' })
  fireEvent.change(input, { target: { value: '東京' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.compositionEnd(input, { data: '東京' })
  const searchedDuringConversion = onSearch.mock.calls.length
  await user.keyboard('{Enter}')
  // Assert
  expect(searchedDuringConversion).toBe(0)
  expect(onSearch).toHaveBeenCalledOnce()
  expect(onSearch).toHaveBeenCalledWith('東京')
})

test('recent searches are still listed after the page reloads', async () => {
  // Arrange
  const user = userEvent.setup()
  const firstVisit = render(<SearchBox onSearch={vi.fn()} />)
  await user.type(
    screen.getByRole('searchbox', { name: 'Search products' }),
    'canvas{Enter}',
  )
  firstVisit.unmount()
  // Act
  render(<SearchBox onSearch={vi.fn()} />)
  // Assert
  const recentSearches = screen.getByRole('list', { name: 'Recent searches' })
  expect(within(recentSearches).getByText('canvas')).toBeVisible()
  expect(localStorage.getItem('recent-searches')).toBe('["canvas"]')
})

test('a corrupted recent-searches entry leaves the search box usable with an empty history', async () => {
  // Arrange
  localStorage.setItem('recent-searches', '["canvas"')
  const user = userEvent.setup()
  const onSearch = vi.fn()
  // Act
  render(<SearchBox onSearch={onSearch} />)
  await user.type(
    screen.getByRole('searchbox', { name: 'Search products' }),
    'chart{Enter}',
  )
  // Assert
  const recentSearches = screen.getByRole('list', { name: 'Recent searches' })
  expect(within(recentSearches).getAllByRole('listitem')).toHaveLength(1)
  expect(within(recentSearches).getByText('chart')).toBeVisible()
  expect(onSearch).toHaveBeenCalledWith('chart')
  expect(localStorage.getItem('recent-searches')).toBe('["chart"]')
})
