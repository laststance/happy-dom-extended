import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Blanks inline code spans, pairing a backtick run with the next run of the same length.
 *
 * @example stripSpans('a `b` c') === 'a  c'
 */
function stripSpans(line) {
  let output = ''
  let index = 0
  while (index < line.length) {
    if (line[index] !== '`') {
      output += line[index]
      index += 1
      continue
    }
    const opener = index
    while (line[index] === '`') index += 1
    const runLength = index - opener
    let search = index
    let closer = -1
    // CommonMark closes a span only on a run of exactly the opening length.
    while (search < line.length) {
      if (line[search] !== '`') {
        search += 1
        continue
      }
      let end = search
      while (line[end] === '`') end += 1
      if (end - search === runLength) {
        closer = end
        break
      }
      search = end
    }
    // An unpaired run is literal text, so keep it and carry on after it.
    if (closer === -1) output += line.slice(opener, index)
    else index = closer
  }
  return output
}

/**
 * Blanks fenced blocks and inline spans so example commands cannot look like links or headings.
 *
 * @example stripCode('````\n```\n````\n# T').split('\n').at(-1) === '# T'
 */
function stripCode(markdown) {
  let fence = ''
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      // A fence closes only on its own character, repeated at least as often as the opener.
      if (fence !== '') {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length)
          fence = ''
        return ''
      }
      if (marker) {
        fence = marker
        return ''
      }
      return stripSpans(line)
    })
    .join('\n')
}

/**
 * Converts heading text to GitHub's fragment identifier, so anchors compare without rendering.
 * Headings containing raw HTML are rejected by {@link htmlHeadingsIn} instead of slugged here.
 *
 * @example headingSlug('Configure Jest or Vitest') === 'configure-jest-or-vitest'
 */
function headingSlug(heading) {
  return heading
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/[*_~]/g, '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number} _-]/gu, '')
    .replaceAll(/ /g, '-')
}

const headingPattern = /^#{1,6}[ \t]+(.+)$/gm

/**
 * Lists headings that carry raw HTML, whose rendered text {@link headingSlug} cannot reproduce.
 *
 * @example htmlHeadingsIn('# A <b>B</b>') → ['A <b>B</b>']
 */
function htmlHeadingsIn(markdown) {
  return [...stripCode(markdown).matchAll(headingPattern)]
    .map(([, heading]) => heading)
    .filter((heading) => heading.includes('<'))
}

/**
 * Collects a file's anchors in document order, numbering repeats the way GitHub does.
 *
 * @example anchorsOf('# A\n# A') → Set { 'a', 'a-1' }
 */
function anchorsOf(markdown) {
  const anchors = new Set()
  const seen = new Map()
  for (const [, heading] of stripCode(markdown).matchAll(headingPattern)) {
    const slug = headingSlug(heading)
    const used = seen.get(slug) ?? 0
    seen.set(slug, used + 1)
    // GitHub keeps the first occurrence bare and suffixes every repeat.
    anchors.add(used === 0 ? slug : `${slug}-${used}`)
  }
  return anchors
}

const anchorCache = new Map()

/** Reads a target file's anchors once per run, because several documents link into the same guide. */
function cachedAnchorsOf(path) {
  if (!anchorCache.has(path))
    anchorCache.set(path, anchorsOf(readFileSync(path, 'utf8')))
  return anchorCache.get(path)
}

/**
 * Yields every link destination, covering inline links, images and reference definitions.
 *
 * @example [...destinationsIn('[a](b(c))')] → ['b(c)']
 */
function* destinationsIn(body) {
  // A reference definition holds its destination alone or ahead of a quoted title.
  for (const [, destination] of body.matchAll(
    /^ {0,3}\[[^\]]+\]:[ \t]*(\S+)(?:[ \t]+["'(][^\n]*)?[ \t]*$/gm,
  ))
    yield destination
  for (const opener of body.matchAll(/\[[^\]]*\]\(/g)) {
    const start = opener.index + opener[0].length
    let cursor = start
    let depth = 1
    // A destination may contain balanced parentheses, so scan rather than match.
    while (cursor < body.length && depth > 0) {
      if (body[cursor] === '(') depth += 1
      else if (body[cursor] === ')') depth -= 1
      cursor += 1
    }
    if (depth === 0) yield body.slice(start, cursor - 1)
  }
}

/**
 * Reports what is wrong with one destination, or nothing when it resolves.
 *
 * @example problemWith('README.md#nope', …) === 'README.md#nope matches no heading in README.md'
 */
function problemWith(destination, absolute, ownAnchors) {
  // A destination may carry a title, and may wrap the target in angle brackets.
  const target = destination.trim().split(/\s+/)[0].replace(/^<|>$/g, '')
  // Registry, mail and protocol-relative targets live outside the repository.
  if (target === '' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return ''
  const [path, ...rest] = target.split('#')
  const anchor = rest.join('#')
  let anchors = ownAnchors
  if (path !== '') {
    const resolved = resolve(dirname(absolute), path)
    if (!existsSync(resolved)) return `${target} points at a missing file`
    // Only Markdown targets have headings to compare an anchor against.
    if (anchor === '' || !resolved.endsWith('.md')) return ''
    anchors = cachedAnchorsOf(resolved)
  }
  if (anchor === '' || anchors.has(anchor)) return ''
  // GitHub generates lowercase anchors, so name the exact one a differing link should use.
  const lowercased = anchor.toLowerCase()
  if (anchors.has(lowercased))
    return `${target} should use the generated anchor #${lowercased}`
  return `${target} matches no heading in ${path === '' ? 'this file' : path}`
}

const files = execFileSync('git', ['ls-files', '-z', '*.md'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)

const problems = []
for (const file of files) {
  const absolute = resolve(repositoryRoot, file)
  const markdown = readFileSync(absolute, 'utf8')
  const ownAnchors = anchorsOf(markdown)
  // A heading with HTML would be slugged wrongly, so name it rather than guess its anchor.
  for (const heading of htmlHeadingsIn(markdown))
    problems.push(
      `${file}: heading "${heading}" contains HTML this check cannot slug`,
    )
  for (const destination of destinationsIn(stripCode(markdown))) {
    const problem = problemWith(destination, absolute, ownAnchors)
    if (problem !== '') problems.push(`${file}: ${problem}`)
  }
}

for (const problem of problems) process.stderr.write(`${problem}\n`)
process.stdout.write(
  problems.length === 0
    ? `Checked relative links and anchors in ${files.length} Markdown files.\n`
    : `Found ${problems.length} problem(s) in ${files.length} Markdown files.\n`,
)
process.exitCode = problems.length === 0 ? 0 : 1
