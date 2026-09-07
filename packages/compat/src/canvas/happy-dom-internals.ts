import { createRequire } from 'node:module'

import type DataURIParserType from 'happy-dom/lib/fetch/data-uri/DataURIParser.js'
import type FetchType from 'happy-dom/lib/fetch/Fetch.js'
import type FetchRequestHeaderUtilityType from 'happy-dom/lib/fetch/utilities/FetchRequestHeaderUtility.js'
import type FetchResponseHeaderUtilityType from 'happy-dom/lib/fetch/utilities/FetchResponseHeaderUtility.js'
import type WindowBrowserContextType from 'happy-dom/lib/window/WindowBrowserContext.js'

// Match the Jest environment's existing native ESM-namespace loading across source ESM and the bundled CommonJS entry.
const require = createRequire(import.meta.url)
export const DataURIParser: typeof DataURIParserType =
  require('happy-dom/lib/fetch/data-uri/DataURIParser.js').default
export const Fetch: typeof FetchType =
  require('happy-dom/lib/fetch/Fetch.js').default
export const FetchRequestHeaderUtility: typeof FetchRequestHeaderUtilityType =
  require('happy-dom/lib/fetch/utilities/FetchRequestHeaderUtility.js').default
export const FetchResponseHeaderUtility: typeof FetchResponseHeaderUtilityType =
  require('happy-dom/lib/fetch/utilities/FetchResponseHeaderUtility.js').default
export const WindowBrowserContext: typeof WindowBrowserContextType =
  require('happy-dom/lib/window/WindowBrowserContext.js').default
