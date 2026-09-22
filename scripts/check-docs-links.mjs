import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Removes fenced blocks and inline spans so example commands cannot look like links or headings.
 *
 * @example stripCode('```sh\n# or\n```\n# Title') === '\n# Title'
 */
function stripCode(markdown) {
  return markdown
    .replaceAll(/^(```|~~~).*?^\1\s*$/gms, '')
    .replaceAll(/`[^`\n]*`/g, '')
}

/**
 * Converts heading text to GitHub's fragment identifier, so anchors can be compared without rendering.
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
function htmlHeadingsIn(markdown) {
  return [...stripCode(markdown).matchAll(/^#{1,6}[ \t]+(.+)$/gm)]
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
  for (const [, heading] of stripCode(markdown).matchAll(
    /^#{1,6}[ \t]+(.+)$/gm,
  )) {
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
  const body = stripCode(markdown)
  const ownAnchors = anchorsOf(markdown)
  // A heading with HTML would be slugged wrongly, so name it rather than guess its anchor.
  for (const heading of htmlHeadingsIn(markdown))
    problems.push(
      `${file}: heading "${heading}" contains HTML this check cannot slug`,
    )
  for (const [, destination] of body.matchAll(/\[[^\]]*\]\(([^()]*)\)/g)) {
    // A destination may carry a title, and may wrap the target in angle brackets.
    const target = destination.trim().split(/\s+/)[0].replace(/^<|>$/g, '')
    // Registry, mail and protocol-relative targets live outside the repository.
    if (target === '' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue
    const [path, anchor] = target.split('#')
    if (path === '') {
      if (!ownAnchors.has(anchor))
        problems.push(`${file}: #${anchor} matches no heading in this file`)
      continue
    }
    const resolved = resolve(dirname(absolute), path)
    if (!existsSync(resolved)) {
      problems.push(`${file}: ${target} points at a missing file`)
      continue
    }
    // Only Markdown targets have headings to compare an anchor against.
    if (
      anchor &&
      resolved.endsWith('.md') &&
      !cachedAnchorsOf(resolved).has(anchor)
    )
      problems.push(`${file}: ${target} matches no heading in ${path}`)
  }
}

for (const problem of problems) process.stderr.write(`${problem}\n`)
process.stdout.write(
  problems.length === 0
    ? `Checked relative links and anchors in ${files.length} Markdown files.\n`
    : `Found ${problems.length} problem(s) in ${files.length} Markdown files.\n`,
)
process.exitCode = problems.length === 0 ? 0 : 1
