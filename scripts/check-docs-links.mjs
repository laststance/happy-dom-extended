import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const fencePattern = /^ {0,3}(`{3,}|~{3,})/
const spanPattern = /(`+)[^\n]*?\1/g
const headingPattern = /^#{1,6}[ \t]+(.+)$/gm
const definitionPattern =
  /^ {0,3}\[[^\]]+\]:[ \t]*(\S+)(?:[ \t]+["'(][^\n]*)?[ \t]*$/gm
const inlineOpenerPattern = /\[[^\]]*\]\(/g
const externalPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

/**
 * Reads the fence marker a line opens or closes with, so its family and length stay known.
 *
 * @example fenceMarkerOf('````sh') === '````'
 */
function fenceMarkerOf(line) {
  return fencePattern.exec(line)?.[1]
}

/**
 * Tells whether a marker closes an open fence: the same character, repeated at least as often.
 *
 * @example closesFence('```', '````') === false
 */
function closesFence(marker, fence) {
  return (
    marker !== undefined &&
    marker[0] === fence[0] &&
    marker.length >= fence.length
  )
}

/**
 * Blanks one line when a fence holds it, and reports the fence still open after it.
 *
 * @example stepFence('```sh', '') → { text: '', fence: '```' }
 */
function stepFence(line, fence) {
  const marker = fenceMarkerOf(line)
  // Inside a fence every line is content, so only a closing marker can end it.
  if (fence !== '')
    return { text: '', fence: closesFence(marker, fence) ? '' : fence }
  if (marker !== undefined) return { text: '', fence: marker }
  return { text: line.replaceAll(spanPattern, ''), fence: '' }
}

/**
 * Blanks fenced blocks and inline spans so example commands cannot look like links or headings.
 *
 * @example stripCode('````\n```\n````\n# T').split('\n').at(-1) === '# T'
 */
function stripCode(markdown) {
  let fence = ''
  const kept = []
  for (const line of markdown.split('\n')) {
    const step = stepFence(line, fence)
    fence = step.fence
    kept.push(step.text)
  }
  return kept.join('\n')
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

/**
 * Lists headings that carry raw HTML, whose rendered text {@link headingSlug} cannot reproduce.
 *
 * @example htmlHeadingsIn('# A <b>B</b>') → ['A <b>B</b>']
 */
function htmlHeadingsIn(body) {
  return [...body.matchAll(headingPattern)]
    .map(([, heading]) => heading)
    .filter((heading) => heading.includes('<'))
}

/**
 * Collects a document's anchors in order, numbering repeated headings the way GitHub does.
 *
 * @example anchorsOf('# A\n# A') → Set { 'a', 'a-1' }
 */
function anchorsOf(body) {
  const anchors = new Set()
  const seen = new Map()
  for (const [, heading] of body.matchAll(headingPattern)) {
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
    anchorCache.set(path, anchorsOf(stripCode(readFileSync(path, 'utf8'))))
  return anchorCache.get(path)
}

/**
 * Yields the destination of every reference definition, which stands alone or before a quoted title.
 *
 * @example [...definitionDestinations('[a]: b.md')] → ['b.md']
 */
function* definitionDestinations(body) {
  for (const [, destination] of body.matchAll(definitionPattern))
    yield destination
}

/**
 * Finds the parenthesis closing a destination opened at from, or -1 when the document has none.
 *
 * @example closingParenthesis('(a(b))', 1) === 5
 */
function closingParenthesis(body, from) {
  let depth = 1
  // A destination may nest balanced parentheses, so track the depth instead of matching.
  for (const match of body.slice(from).matchAll(/[()]/g)) {
    depth += match[0] === '(' ? 1 : -1
    if (depth === 0) return from + match.index
  }
  return -1
}

/**
 * Yields every inline destination, including images and destinations holding parentheses.
 *
 * @example [...inlineDestinations('[a](b(c))')] → ['b(c)']
 */
function* inlineDestinations(body) {
  for (const opener of body.matchAll(inlineOpenerPattern)) {
    const start = opener.index + opener[0].length
    const end = closingParenthesis(body, start)
    if (end !== -1) yield body.slice(start, end)
  }
}

/** Yields every link destination a document declares, in either Markdown form. */
function* destinationsIn(body) {
  yield* definitionDestinations(body)
  yield* inlineDestinations(body)
}

/**
 * Splits a destination into its target and fragment, dropping any title and angle brackets.
 *
 * @example targetOf('<a.md#b> "t"') → { target: 'a.md#b', path: 'a.md', anchor: 'b' }
 */
function targetOf(destination) {
  const target = destination.trim().split(/\s+/)[0].replace(/^<|>$/g, '')
  const [path, ...rest] = target.split('#')
  return { target, path, anchor: rest.join('#') }
}

/**
 * Names the generated anchor a fragment should use, or reports that it matches no heading.
 *
 * @example anchorProblem('a.md#X', 'X', new Set(['x']), 'a.md') includes 'generated anchor #x'
 */
function anchorProblem(target, anchor, anchors, where) {
  if (anchors.has(anchor)) return ''
  // GitHub generates lowercase anchors, so name the exact one a differing link should use.
  const lowercased = anchor.toLowerCase()
  if (anchors.has(lowercased))
    return `${target} should use the generated anchor #${lowercased}`
  return `${target} matches no heading in ${where}`
}

/**
 * Reports a destination that leaves this document, checking the file and then its anchor.
 *
 * @example fileProblem('gone.md', 'gone.md', '', '/repo/README.md') includes 'missing file'
 */
function fileProblem(target, path, anchor, absolute) {
  const resolved = resolve(dirname(absolute), path)
  if (!existsSync(resolved)) return `${target} points at a missing file`
  // Only a Markdown target has headings to compare an anchor against.
  if (anchor === '' || !resolved.endsWith('.md')) return ''
  return anchorProblem(target, anchor, cachedAnchorsOf(resolved), path)
}

/**
 * Tells whether a target leaves the repository, so this check cannot resolve it.
 *
 * @example isExternal('mailto:a@example.com') === true
 */
function isExternal(target) {
  return target === '' || externalPattern.test(target)
}

/**
 * Reports what is wrong with one destination, or nothing when it resolves.
 *
 * @example problemWith('#gone', '/repo/README.md', new Set()) includes 'matches no heading'
 */
function problemWith(destination, absolute, ownAnchors) {
  const { target, path, anchor } = targetOf(destination)
  // Registry, mail and protocol-relative targets live outside the repository.
  if (isExternal(target)) return ''
  if (path !== '') return fileProblem(target, path, anchor, absolute)
  if (anchor === '') return ''
  return anchorProblem(target, anchor, ownAnchors, 'this file')
}

/**
 * Lists every problem one tracked document has, each prefixed with that document's path.
 *
 * @example problemsIn('SECURITY.md') → ['SECURITY.md: README.md#x matches no heading in README.md']
 */
function problemsIn(file) {
  const absolute = resolve(repositoryRoot, file)
  const body = stripCode(readFileSync(absolute, 'utf8'))
  const ownAnchors = anchorsOf(body)
  // A heading with HTML would be slugged wrongly, so name it rather than guess its anchor.
  const found = htmlHeadingsIn(body).map(
    (heading) => `heading "${heading}" contains HTML this check cannot slug`,
  )
  for (const destination of destinationsIn(body)) {
    const problem = problemWith(destination, absolute, ownAnchors)
    if (problem !== '') found.push(problem)
  }
  return found.map((problem) => `${file}: ${problem}`)
}

const files = execFileSync('git', ['ls-files', '-z', '*.md'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)

const problems = files.flatMap(problemsIn)
for (const problem of problems) process.stderr.write(`${problem}\n`)
process.stdout.write(
  problems.length === 0
    ? `Checked relative links and anchors in ${files.length} Markdown files.\n`
    : `Found ${problems.length} problem(s) in ${files.length} Markdown files.\n`,
)
process.exitCode = problems.length === 0 ? 0 : 1
