import { describe, it, expect } from '@jest/globals';
import escapeTagHeadings from './escapeTagHeadings.js';

describe('escapeTagHeadings', () => {
    it('escapes a single-hash tag at the start of a line', () => {
        const result = escapeTagHeadings('#dmnote');
        expect(result.content).toBe('\\#dmnote');
        expect(result.escaped).toBe(1);
    });

    it('escapes multi-hash tags (##tag, ###tag)', () => {
        const result = escapeTagHeadings('##nested\n###deep');
        expect(result.content).toBe('\\##nested\n\\###deep');
        expect(result.escaped).toBe(2);
    });

    it('does not escape real ATX headings (hash followed by space)', () => {
        const input = '# Real Heading\n## Subheading\n### Subsubheading';
        const result = escapeTagHeadings(input);
        expect(result.content).toBe(input);
        expect(result.escaped).toBe(0);
    });

    it('does not escape an isolated # on its own', () => {
        const result = escapeTagHeadings('#');
        expect(result.content).toBe('#');
        expect(result.escaped).toBe(0);
    });

    it('escapes obsidian tags with hyphens, underscores, and slashes', () => {
        const result = escapeTagHeadings('#tag-with-dash\n#tag_with_underscore\n#nested/tag');
        expect(result.content).toBe('\\#tag-with-dash\n\\#tag_with_underscore\n\\#nested/tag');
        expect(result.escaped).toBe(3);
    });

    it('leaves inline tags (mid-line) untouched', () => {
        const input = 'See also #foo for context.';
        const result = escapeTagHeadings(input);
        expect(result.content).toBe(input);
        expect(result.escaped).toBe(0);
    });

    it('does not escape tags inside fenced code blocks', () => {
        const input = '#tag\n\n```\n#define MAX 10\n#include <stdio.h>\n```\n\n#anothertag';
        const result = escapeTagHeadings(input);
        expect(result.content).toContain('\\#tag');
        expect(result.content).toContain('#define MAX 10');
        expect(result.content).toContain('#include <stdio.h>');
        expect(result.content).toContain('\\#anothertag');
        expect(result.escaped).toBe(2);
    });

    it('does not escape tags inside tilde-fenced code blocks', () => {
        const input = '~~~\n#code\n~~~\n#realtag';
        const result = escapeTagHeadings(input);
        expect(result.content).toBe('~~~\n#code\n~~~\n\\#realtag');
        expect(result.escaped).toBe(1);
    });

    it('handles mixed real headings and tags in one document', () => {
        const input = '# Document Title\n\n#dmnote\n\nSome text.\n\n## Section\n\n#tag-2';
        const result = escapeTagHeadings(input);
        expect(result.content).toBe('# Document Title\n\n\\#dmnote\n\nSome text.\n\n## Section\n\n\\#tag-2');
        expect(result.escaped).toBe(2);
    });

    it('preserves CRLF line endings as LF (consistent with other preprocessors)', () => {
        const input = '#tag\r\nbody';
        const result = escapeTagHeadings(input);
        expect(result.content).toBe('\\#tag\nbody');
    });

    it('returns empty result for empty input', () => {
        expect(escapeTagHeadings('')).toEqual({ content: '', escaped: 0 });
        expect(escapeTagHeadings(null)).toEqual({ content: '', escaped: 0 });
        expect(escapeTagHeadings(undefined)).toEqual({ content: '', escaped: 0 });
    });

    it('does not double-escape an already-escaped line', () => {
        const result = escapeTagHeadings('\\#already');
        expect(result.content).toBe('\\#already');
        expect(result.escaped).toBe(0);
    });
});
