/**
 * Escapes Obsidian-style tags (`#tag`) at the start of a line so they aren't
 * misinterpreted as ATX headings during markdown-to-HTML conversion.
 *
 * Markdown ATX headings strictly require a space between `#` and the heading
 * text (`# Heading`), but Showdown accepts the no-space form (`#Heading`) as a
 * heading too. That collides with Obsidian tag syntax — a line starting with
 * `#dmnote` should render as a tag, not as an `<h1>dmnote</h1>`.
 *
 * Fix: when a line starts with one or more `#` followed immediately by a
 * non-space character, prepend a backslash to escape the first `#`. Showdown
 * renders `\#dmnote` as a literal `#dmnote` text node, preserving the tag
 * visually and breaking the heading-detection path.
 *
 * Lines that look like real headings (`# Heading`, `## Subheading`) are
 * untouched. Content inside fenced code blocks is also untouched, since those
 * blocks render verbatim.
 */
const TAG_AT_LINE_START = /^(#+)([^\s#])/;

/**
 * @param {string} content - Markdown content to process
 * @returns {{ content: string, escaped: number }} Processed content plus the
 *   number of lines that were escaped (for reporting / tests)
 */
export default function escapeTagHeadings(content) {
    if (!content) {
        return { content: '', escaped: 0 };
    }

    const lines = content.split(/\r?\n/);
    let inCodeBlock = false;
    let escaped = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }

        if (inCodeBlock) {
            continue;
        }

        if (TAG_AT_LINE_START.test(line)) {
            lines[i] = `\\${line}`;
            escaped++;
        }
    }

    return { content: lines.join('\n'), escaped };
}
