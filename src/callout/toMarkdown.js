/**
 * Extracts Obsidian callout elements (.obsidian-callout) and Foundry native
 * secret blocks (section.secret) from HTML content, replacing them with
 * placeholders. Uses DOMParser to walk the document.
 *
 * @param {string} htmlContent - The HTML content to process
 * @param {object} showdownConverter - Showdown converter instance with makeMarkdown method
 * @returns {{ content: string, callouts: object[] }}
 */
export function extractCalloutsToPlaceholders(htmlContent, showdownConverter) {
    if (!htmlContent) {
        return { content: '', callouts: [] };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    unwrapNestedSecretSections(doc);

    const targets = collectCalloutTargets(doc);

    if (targets.length === 0) {
        return { content: htmlContent, callouts: [] };
    }

    const callouts = [];

    targets.forEach((element, index) => {
        const callout = element.classList.contains('obsidian-callout')
            ? extractObsidianCallout(element, showdownConverter)
            : extractSecretSection(element, showdownConverter);

        callouts.push(callout);

        const placeholder = doc.createElement('p');
        placeholder.textContent = `{{CALLOUT:${index}}}`;
        element.parentNode.replaceChild(placeholder, element);
    });

    return { content: doc.body.innerHTML, callouts };
}

/**
 * Collects callout-bearing elements in document order so placeholder indices
 * match their position in the original HTML. Both .obsidian-callout and
 * section.secret blocks are returned in a single ordered list.
 */
function collectCalloutTargets(doc) {
    const all = doc.querySelectorAll('.obsidian-callout, section.secret');
    return Array.from(all);
}

/**
 * Foundry V13 has a known bug with nested secret blocks. Per spec, do not
 * produce nested secret block output. Best-effort defense: when one
 * section.secret contains another, replace each inner one with its children
 * before extraction so a single, flat secret block remains.
 */
function unwrapNestedSecretSections(doc) {
    let nested = doc.querySelectorAll('section.secret section.secret');
    while (nested.length > 0) {
        nested.forEach(inner => {
            while (inner.firstChild) {
                inner.parentNode.insertBefore(inner.firstChild, inner);
            }
            inner.parentNode.removeChild(inner);
        });
        nested = doc.querySelectorAll('section.secret section.secret');
    }
}

function extractObsidianCallout(element, showdownConverter) {
    const type = element.getAttribute('data-callout-type') || 'note';
    const customTitleAttr = element.getAttribute('data-callout-custom-title');
    const customTitle = customTitleAttr !== 'false';

    const tagName = element.tagName.toLowerCase();
    const foldable = tagName === 'details';
    const defaultOpen = foldable ? element.hasAttribute('open') : true;

    const titleElement = element.querySelector('.callout-title');
    const titleHtml = titleElement ? titleElement.innerHTML : '';
    const title = showdownConverter.makeMarkdown(titleHtml).trim();

    const contentElement = element.querySelector('.callout-content');
    const contentHtml = contentElement ? contentElement.innerHTML : '';
    const body = showdownConverter.makeMarkdown(contentHtml).trim();

    return { type, title, customTitle, foldable, defaultOpen, body };
}

/**
 * Extracts a Foundry native secret block. If the first child is a
 * <p><strong>...</strong></p> with no other content, treat it as the callout
 * title (matching the format produced by replace.js on import). Otherwise no
 * title is reconstructed.
 */
function extractSecretSection(element, showdownConverter) {
    const firstChild = element.firstElementChild;
    let title = '';
    let customTitle = false;
    let bodyRoot = element;

    if (isStrongOnlyParagraph(firstChild)) {
        const strong = firstChild.querySelector('strong');
        const titleHtml = strong.innerHTML;
        title = showdownConverter.makeMarkdown(titleHtml).trim();
        customTitle = title.length > 0;

        const clone = element.cloneNode(true);
        clone.removeChild(clone.firstElementChild);
        bodyRoot = clone;
    }

    const body = showdownConverter.makeMarkdown(bodyRoot.innerHTML).trim();

    return {
        type: 'secret',
        title,
        customTitle,
        foldable: false,
        defaultOpen: true,
        body
    };
}

function isStrongOnlyParagraph(node) {
    if (!node || node.tagName?.toLowerCase() !== 'p') {
        return false;
    }
    if (node.children.length !== 1) {
        return false;
    }
    const child = node.children[0];
    if (child.tagName?.toLowerCase() !== 'strong') {
        return false;
    }
    return node.textContent.trim() === child.textContent.trim();
}

/**
 * Restores callout placeholders in content with Obsidian callout markdown syntax.
 *
 * @param {string} content - Content with {{CALLOUT:N}} placeholders
 * @param {object[]} callouts - Array of callout data objects
 * @returns {string} - Content with placeholders replaced by Obsidian callout syntax
 */
export function restoreCalloutPlaceholders(content, callouts) {
    if (!content) {
        return '';
    }

    let result = content;

    for (let i = 0; i < callouts.length; i++) {
        const callout = callouts[i];
        const placeholder = `{{CALLOUT:${i}}}`;
        const markdown = buildCalloutMarkdown(callout);
        result = result.replace(placeholder, markdown);
    }

    return result;
}

/**
 * Builds Obsidian callout markdown syntax from callout data.
 *
 * @param {object} callout - Callout data object
 * @returns {string} - Obsidian callout markdown
 */
function buildCalloutMarkdown(callout) {
    const { type, title, customTitle, foldable, defaultOpen, body } = callout;

    let modifier = '';
    if (foldable) {
        modifier = defaultOpen ? '+' : '-';
    }

    let header = `> [!${type}]${modifier}`;
    if (customTitle && title) {
        header += ` ${title}`;
    }

    if (!body) {
        return header;
    }

    const bodyLines = body.split('\n').map(line => `> ${line}`).join('\n');

    return `${header}\n${bodyLines}`;
}
