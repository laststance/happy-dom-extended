import { useRef, useState } from 'react'

const RECENT_SEARCHES_KEY = 'recent-searches'
const MAX_RECENT_SEARCHES = 3

/** Reads the searches an earlier visit saved, ignoring malformed storage.
 * @returns Saved queries, newest first; empty when nothing valid is stored.
 * @example readRecentSearches() // => ['canvas']
 */
function readRecentSearches(): string[] {
  let saved: unknown
  try {
    saved = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]')
  } catch (error) {
    // Text that is not JSON, such as a hand-edited entry, must not break the page.
    if (error instanceof SyntaxError) return []
    throw error
  }
  return Array.isArray(saved)
    ? saved.filter((entry) => typeof entry === 'string')
    : []
}

type SearchBoxProps = {
  onSearch: (query: string) => void
}

/** Product search that ignores the Enter confirming a Japanese IME conversion and remembers recent searches.
 * Composition events carry real CompositionEvent data, and recent searches persist in localStorage.
 * @param props - Callback that runs a confirmed search.
 * @returns A search input and the recent searches list.
 * @example <SearchBox onSearch={(query) => router.push(`/search?q=${query}`)} />
 */
export function SearchBox({ onSearch }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState(readRecentSearches)
  const isComposingRef = useRef(false)

  function search() {
    const nextRecentSearches = [
      query,
      ...recentSearches.filter((recent) => recent !== query),
    ].slice(0, MAX_RECENT_SEARCHES)
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify(nextRecentSearches),
    )
    setRecentSearches(nextRecentSearches)
    onSearch(query)
  }

  return (
    <div>
      <input
        type="search"
        aria-label="Search products"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onCompositionStart={() => {
          isComposingRef.current = true
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false
        }}
        onKeyDown={(event) => {
          // The Enter that confirms an IME conversion must not search a half-typed query.
          if (
            event.key === 'Enter' &&
            !isComposingRef.current &&
            !event.nativeEvent.isComposing
          )
            search()
        }}
      />
      <ul aria-label="Recent searches">
        {recentSearches.map((recent) => (
          <li key={recent}>{recent}</li>
        ))}
      </ul>
    </div>
  )
}
