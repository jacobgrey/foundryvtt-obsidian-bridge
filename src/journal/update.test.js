import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { updateContent, rollbackUpdates } from './update';
import MarkdownFile from '../domain/MarkdownFile';

describe('journal/update', () => {
    let mockFromUuidSync;
    let consoleWarnSpy;

    beforeEach(() => {
        mockFromUuidSync = jest.fn();
        global.fromUuidSync = mockFromUuidSync;

        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    describe('updateContent', () => {
        it('updates page content for valid markdown files', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original content</p>' },
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>'
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            const result = await updateContent([markdownFile]);

            expect(mockFromUuidSync).toHaveBeenCalledWith(mockPage.uuid);
            expect(mockPage.update).toHaveBeenCalledWith({
                'text.content': '<p>New content</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': expect.any(Number)
            });

            expect(result.updatedPages).toHaveLength(1);
            expect(result.updatedPages[0].page).toBe(mockPage);
            expect(result.updatedPages[0].originalContent).toBe('<p>Original content</p>');
        });

        it('updates multiple pages', async () => {
            const mockPage1 = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original 1</p>' },
                update: jest.fn().mockResolvedValue()
            };

            const mockPage2 = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-2',
                text: { content: '<p>Original 2</p>' },
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync
                .mockReturnValueOnce(mockPage1)
                .mockReturnValueOnce(mockPage2);

            const markdownFile1 = new MarkdownFile({
                filePath: 'test1.md',
                content: '<p>New 1</p>'
            });
            markdownFile1.foundryPageUuid = mockPage1.uuid;

            const markdownFile2 = new MarkdownFile({
                filePath: 'test2.md',
                content: '<p>New 2</p>'
            });
            markdownFile2.foundryPageUuid = mockPage2.uuid;

            const result = await updateContent([markdownFile1, markdownFile2]);

            expect(mockPage1.update).toHaveBeenCalledWith({
                'text.content': '<p>New 1</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': expect.any(Number)
            });
            expect(mockPage2.update).toHaveBeenCalledWith({
                'text.content': '<p>New 2</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': expect.any(Number)
            });

            expect(result.updatedPages).toHaveLength(2);
        });

        it('handles pages with no existing content', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: {},
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>'
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            const result = await updateContent([markdownFile]);

            expect(result.updatedPages[0].originalContent).toBe('');
        });

        it('handles pages with null text property', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: null,
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>'
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            const result = await updateContent([markdownFile]);

            expect(result.updatedPages[0].originalContent).toBe('');
        });

        it('skips files without foundryPageUuid and warns', async () => {
            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>Content</p>'
            });

            const result = await updateContent([markdownFile]);

            expect(consoleWarnSpy).toHaveBeenCalledWith('Skipping page without UUID: test.md');
            expect(mockFromUuidSync).not.toHaveBeenCalled();
            expect(result.updatedPages).toHaveLength(0);
        });

        it('throws error when page is not found', async () => {
            mockFromUuidSync.mockReturnValue(null);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>Content</p>'
            });
            markdownFile.foundryPageUuid = 'JournalEntry.entry-1.JournalEntryPage.missing';

            await expect(updateContent([markdownFile]))
                .rejects.toThrow('Page not found for UUID: JournalEntry.entry-1.JournalEntryPage.missing (test.md)');
        });

        it('returns empty updatedPages for empty array', async () => {
            const result = await updateContent([]);

            expect(result.updatedPages).toHaveLength(0);
            expect(mockFromUuidSync).not.toHaveBeenCalled();
        });

        it('returns empty updatedPages for null input', async () => {
            const result = await updateContent(null);

            expect(result.updatedPages).toHaveLength(0);
            expect(mockFromUuidSync).not.toHaveBeenCalled();
        });

        it('returns empty updatedPages for undefined input', async () => {
            const result = await updateContent(undefined);

            expect(result.updatedPages).toHaveLength(0);
            expect(mockFromUuidSync).not.toHaveBeenCalled();
        });

        it('continues processing after skipping file without UUID', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original</p>' },
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFileWithoutUuid = new MarkdownFile({
                filePath: 'no-uuid.md',
                content: '<p>Content 1</p>'
            });

            const markdownFileWithUuid = new MarkdownFile({
                filePath: 'with-uuid.md',
                content: '<p>Content 2</p>'
            });
            markdownFileWithUuid.foundryPageUuid = mockPage.uuid;

            const result = await updateContent([markdownFileWithoutUuid, markdownFileWithUuid]);

            expect(consoleWarnSpy).toHaveBeenCalledWith('Skipping page without UUID: no-uuid.md');
            expect(mockPage.update).toHaveBeenCalled();
            expect(result.updatedPages).toHaveLength(1);
        });

        it('stores frontmatter flag alongside content', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original</p>' },
                flags: {},
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>',
                frontmatter: 'title: Hello'
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            await updateContent([markdownFile]);

            expect(mockPage.update).toHaveBeenCalledWith({
                'text.content': '<p>New content</p>',
                'flags.obsidian-bridge.frontmatter': 'title: Hello',
                'flags.obsidian-bridge.lastSyncedAt': expect.any(Number)
            });
        });

        it('clears frontmatter flag when frontmatter is null', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original</p>' },
                flags: { 'obsidian-bridge': { frontmatter: 'old: value' } },
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>',
                frontmatter: null
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            await updateContent([markdownFile]);

            expect(mockPage.update).toHaveBeenCalledWith({
                'text.content': '<p>New content</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': expect.any(Number)
            });
        });

        it('includes originalFrontmatter in return for rollback', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original</p>' },
                flags: { 'obsidian-bridge': { frontmatter: 'original: frontmatter' } },
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>',
                frontmatter: 'new: frontmatter'
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            const result = await updateContent([markdownFile]);

            expect(result.updatedPages[0].originalFrontmatter).toBe('original: frontmatter');
        });

        describe('ownership rules', () => {
            function makeEntry({ id = 'entry-1', ownership = null, updateImpl } = {}) {
                return {
                    id,
                    uuid: `JournalEntry.${id}`,
                    ownership,
                    update: jest.fn().mockImplementation(updateImpl ?? (() => Promise.resolve()))
                };
            }

            function makePage({ uuid, parent, ownership = null }) {
                return {
                    uuid,
                    text: { content: '<p>orig</p>' },
                    flags: {},
                    ownership,
                    parent,
                    update: jest.fn().mockResolvedValue()
                };
            }

            it('writes opt-in ownership on a page with show-players', async () => {
                const entry = makeEntry({ ownership: { default: 1 } });
                const page = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.p',
                    parent: entry,
                    ownership: { default: -1 }
                });
                mockFromUuidSync.mockReturnValue(page);

                const md = new MarkdownFile({ filePath: 't.md', content: '<p>new</p>' });
                md.foundryPageUuid = page.uuid;
                md.pagePermission = 2;

                await updateContent([md]);

                expect(page.update).toHaveBeenCalledWith(expect.objectContaining({
                    'ownership.default': 2
                }));
            });

            it('does not touch ownership for an existing page with no opt-in when parent is unchanged', async () => {
                const entry = makeEntry({ ownership: { default: 0 } });
                const page = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.p',
                    parent: entry,
                    ownership: { default: -1 }
                });
                mockFromUuidSync.mockReturnValue(page);

                const md = new MarkdownFile({ filePath: 't.md', content: '<p>new</p>' });
                md.foundryPageUuid = page.uuid;

                await updateContent([md]);

                const call = page.update.mock.calls[0][0];
                expect(call).not.toHaveProperty('ownership.default');
                expect(call).not.toHaveProperty('ownership');
            });

            it('writes explicit NONE on a no-opt-in page that inherits when parent is being elevated', async () => {
                const entry = makeEntry({ ownership: { default: 0 } });
                const inheritingPage = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.silent',
                    parent: entry,
                    ownership: { default: -1 }
                });
                const optInPage = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.loud',
                    parent: entry,
                    ownership: { default: -1 }
                });
                mockFromUuidSync
                    .mockImplementation(uuid => uuid === inheritingPage.uuid ? inheritingPage : optInPage);

                const silent = new MarkdownFile({ filePath: 'silent.md', content: '<p>x</p>' });
                silent.foundryPageUuid = inheritingPage.uuid;
                const loud = new MarkdownFile({ filePath: 'loud.md', content: '<p>y</p>' });
                loud.foundryPageUuid = optInPage.uuid;
                loud.pagePermission = 3;

                await updateContent([silent, loud]);

                expect(entry.update).toHaveBeenCalledWith({ 'ownership.default': 1 });
                expect(inheritingPage.update).toHaveBeenCalledWith(expect.objectContaining({
                    'ownership.default': 0
                }));
            });

            it('preserves manual GM ownership on an existing page with explicit ownership and no opt-in', async () => {
                const entry = makeEntry({ ownership: { default: 1 } });
                const page = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.p',
                    parent: entry,
                    ownership: { default: 2 }
                });
                mockFromUuidSync.mockReturnValue(page);

                const md = new MarkdownFile({ filePath: 't.md', content: '<p>new</p>' });
                md.foundryPageUuid = page.uuid;

                await updateContent([md]);

                const call = page.update.mock.calls[0][0];
                expect(call).not.toHaveProperty('ownership');
            });

            it('does not raise an entry that is already at LIMITED or above', async () => {
                const entry = makeEntry({ ownership: { default: 2 } });
                const page = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.p',
                    parent: entry,
                    ownership: { default: -1 }
                });
                mockFromUuidSync.mockReturnValue(page);

                const md = new MarkdownFile({ filePath: 't.md', content: '<p>x</p>' });
                md.foundryPageUuid = page.uuid;
                md.pagePermission = 3;

                await updateContent([md]);

                expect(entry.update).not.toHaveBeenCalled();
            });

            it('skips ownership write on newly created pages (already set at create time)', async () => {
                const entry = makeEntry({ ownership: { default: 1 } });
                const page = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.new',
                    parent: entry,
                    ownership: { default: -1 }
                });
                mockFromUuidSync.mockReturnValue(page);

                const md = new MarkdownFile({ filePath: 't.md', content: '<p>x</p>' });
                md.foundryPageUuid = page.uuid;

                const createResult = {
                    createdPages: [{ entry, page }],
                    createdEntries: [entry]
                };

                await updateContent([md], createResult);

                const call = page.update.mock.calls[0][0];
                expect(call).not.toHaveProperty('ownership');
                expect(entry.update).not.toHaveBeenCalled();
            });

            it('returns updatedEntries entries for entries that were elevated', async () => {
                const entry = makeEntry({ ownership: { default: 0 } });
                const page = makePage({
                    uuid: 'JournalEntry.entry-1.JournalEntryPage.p',
                    parent: entry,
                    ownership: { default: -1 }
                });
                mockFromUuidSync.mockReturnValue(page);

                const md = new MarkdownFile({ filePath: 't.md', content: '<p>x</p>' });
                md.foundryPageUuid = page.uuid;
                md.pagePermission = 3;

                const result = await updateContent([md]);

                expect(result.updatedEntries).toHaveLength(1);
                expect(result.updatedEntries[0].entry).toBe(entry);
                expect(result.updatedEntries[0].originalOwnershipDefault).toBe(0);
            });
        });

        it('handles missing flags when storing originalFrontmatter', async () => {
            const mockPage = {
                uuid: 'JournalEntry.entry-1.JournalEntryPage.page-1',
                text: { content: '<p>Original</p>' },
                update: jest.fn().mockResolvedValue()
            };

            mockFromUuidSync.mockReturnValue(mockPage);

            const markdownFile = new MarkdownFile({
                filePath: 'test.md',
                content: '<p>New content</p>',
                frontmatter: 'new: frontmatter'
            });
            markdownFile.foundryPageUuid = mockPage.uuid;

            const result = await updateContent([markdownFile]);

            expect(result.updatedPages[0].originalFrontmatter).toBeNull();
        });
    });

    describe('rollbackUpdates', () => {
        it('restores original content in reverse order', async () => {
            const updateOrder = [];

            const mockPage1 = {
                uuid: 'page-1',
                update: jest.fn().mockImplementation(data => {
                    updateOrder.push('page1');
                    return Promise.resolve();
                })
            };

            const mockPage2 = {
                uuid: 'page-2',
                update: jest.fn().mockImplementation(data => {
                    updateOrder.push('page2');
                    return Promise.resolve();
                })
            };

            const updatedPages = [
                { page: mockPage1, originalContent: '<p>Original 1</p>', originalFrontmatter: null, originalLastSyncedAt: 1000 },
                { page: mockPage2, originalContent: '<p>Original 2</p>', originalFrontmatter: null, originalLastSyncedAt: 2000 }
            ];

            await rollbackUpdates(updatedPages);

            expect(mockPage2.update).toHaveBeenCalledWith({
                'text.content': '<p>Original 2</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': 2000
            });
            expect(mockPage1.update).toHaveBeenCalledWith({
                'text.content': '<p>Original 1</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': 1000
            });
            expect(updateOrder).toEqual(['page2', 'page1']);
        });

        it('continues on error and does not throw', async () => {
            const mockPage1 = {
                uuid: 'page-1',
                update: jest.fn().mockRejectedValue(new Error('Update failed'))
            };

            const mockPage2 = {
                uuid: 'page-2',
                update: jest.fn().mockResolvedValue()
            };

            const updatedPages = [
                { page: mockPage1, originalContent: '<p>Original 1</p>', originalFrontmatter: null, originalLastSyncedAt: null },
                { page: mockPage2, originalContent: '<p>Original 2</p>', originalFrontmatter: null, originalLastSyncedAt: null }
            ];

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            await expect(rollbackUpdates(updatedPages)).resolves.not.toThrow();

            expect(mockPage2.update).toHaveBeenCalled();
            expect(mockPage1.update).toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });

        it('handles empty array', async () => {
            await expect(rollbackUpdates([])).resolves.not.toThrow();
        });

        it('handles null input', async () => {
            await expect(rollbackUpdates(null)).resolves.not.toThrow();
        });

        it('handles undefined input', async () => {
            await expect(rollbackUpdates(undefined)).resolves.not.toThrow();
        });

        it('does not mutate original array', async () => {
            const mockPage = {
                uuid: 'page-1',
                update: jest.fn().mockResolvedValue()
            };

            const updatedPages = [
                { page: mockPage, originalContent: '<p>Original</p>', originalFrontmatter: null, originalLastSyncedAt: null }
            ];

            const originalLength = updatedPages.length;

            await rollbackUpdates(updatedPages);

            expect(updatedPages).toHaveLength(originalLength);
            expect(updatedPages[0].page).toBe(mockPage);
        });

        it('restores both content and frontmatter flag', async () => {
            const mockPage = {
                uuid: 'page-1',
                update: jest.fn().mockResolvedValue()
            };

            const updatedPages = [
                {
                    page: mockPage,
                    originalContent: '<p>Original</p>',
                    originalFrontmatter: 'title: Original',
                    originalLastSyncedAt: 12345
                }
            ];

            await rollbackUpdates(updatedPages);

            expect(mockPage.update).toHaveBeenCalledWith({
                'text.content': '<p>Original</p>',
                'flags.obsidian-bridge.frontmatter': 'title: Original',
                'flags.obsidian-bridge.lastSyncedAt': 12345
            });
        });

        it('restores entry ownership when updatedEntries is provided', async () => {
            const entry = {
                uuid: 'JournalEntry.entry-1',
                id: 'entry-1',
                update: jest.fn().mockResolvedValue()
            };

            await rollbackUpdates([], [
                { entry, originalOwnershipDefault: 0 }
            ]);

            expect(entry.update).toHaveBeenCalledWith({ 'ownership.default': 0 });
        });

        it('restores both pages and entries when both provided', async () => {
            const callOrder = [];
            const page = {
                uuid: 'p',
                update: jest.fn().mockImplementation(() => { callOrder.push('page'); return Promise.resolve(); })
            };
            const entry = {
                uuid: 'JournalEntry.entry-1',
                id: 'entry-1',
                update: jest.fn().mockImplementation(() => { callOrder.push('entry'); return Promise.resolve(); })
            };

            await rollbackUpdates(
                [{ page, originalContent: '', originalFrontmatter: null, originalLastSyncedAt: null, originalOwnershipDefault: 1 }],
                [{ entry, originalOwnershipDefault: 0 }]
            );

            expect(page.update).toHaveBeenCalledWith(expect.objectContaining({
                'ownership.default': 1
            }));
            expect(entry.update).toHaveBeenCalled();
            expect(callOrder).toEqual(['page', 'entry']);
        });

        it('skips ownership in page rollback payload when originalOwnershipDefault is null', async () => {
            const page = { uuid: 'p', update: jest.fn().mockResolvedValue() };

            await rollbackUpdates(
                [{ page, originalContent: '', originalFrontmatter: null, originalLastSyncedAt: null, originalOwnershipDefault: null }],
                []
            );

            const call = page.update.mock.calls[0][0];
            expect(call).not.toHaveProperty('ownership.default');
            expect(call).not.toHaveProperty('ownership');
        });

        it('restores null frontmatter correctly', async () => {
            const mockPage = {
                uuid: 'page-1',
                update: jest.fn().mockResolvedValue()
            };

            const updatedPages = [
                {
                    page: mockPage,
                    originalContent: '<p>Original</p>',
                    originalFrontmatter: null,
                    originalLastSyncedAt: null
                }
            ];

            await rollbackUpdates(updatedPages);

            expect(mockPage.update).toHaveBeenCalledWith({
                'text.content': '<p>Original</p>',
                'flags.obsidian-bridge.frontmatter': null,
                'flags.obsidian-bridge.lastSyncedAt': null
            });
        });
    });
});
