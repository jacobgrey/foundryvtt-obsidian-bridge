import PipelineConfig from '../domain/PipelineConfig';
import PhaseDefinition from '../domain/PhaseDefinition';
import { collectSelectedPaths } from '../tree/collect';
import { filterFilesBySelection } from '../vault/filter';
import prepareFilesForImport from '../vault/prepare.js';
import { extractLinkReferences, extractAssetReferences } from '../reference/extractFromMarkdown.js';
import replaceWithPlaceholders from '../reference/replace.js';
import planJournalStructure from '../journal/plan';
import resolvePlaceholders from '../reference/resolve.js';
import { createJournals, rollbackJournals } from '../journal/create';
import { uploadAssets, rollbackUploads } from '../asset/upload';
import { updateContent, rollbackUpdates } from '../journal/update';
import { extractFrontmatter } from '../content/frontmatter.js';
import convertNewlinesToBr from '../content/markdownPreprocess.js';
import escapeTagHeadings from '../content/escapeTagHeadings.js';
import { extractCallouts } from '../callout/extract.js';
import { replaceCalloutPlaceholders } from '../callout/replace.js';
import { detectConflicts, filterSkippedFiles } from '../conflict/detectConflicts.js';
import ConflictDialog from '../ui/ConflictDialog.js';
import { extractStatblocks } from '../statblock/extract.js';
import { parseStatblock } from '../statblock/parse.js';
import StatblockAdapterRegistry from '../statblock/registry.js';
import { id as MODULE_ID } from '../../module.json';

/**
 * Gets the parent folder path from a file path.
 * @param {string} filePath - Full file path like "Bestiary/Bugbears/Bugbear Brute.md"
 * @returns {string|null} Parent path like "Bestiary/Bugbears" or null if at root
 */
function getParentPath(filePath) {
    if (!filePath) {
        return null;
    }
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash <= 0) {
        return null;
    }
    return filePath.substring(0, lastSlash);
}

/**
 * Creates Actor folders to mirror the vault folder structure.
 * @param {StatblockData[]} statblocks - Array of parsed statblocks
 * @param {string} vaultRoot - Vault root path to strip (e.g., "Cormyr A Campaign/")
 * @param {string[]} createdFolderIds - Array to track created folder IDs for rollback
 * @returns {Promise<Map<string, Folder>>} Map of path to Folder
 */
async function createActorFolders(statblocks, vaultRoot, createdFolderIds) {
    const folderMap = new Map();

    const folderPaths = new Set();
    for (const statblock of statblocks) {
        let filePath = statblock.filePath;
        if (vaultRoot && filePath.startsWith(vaultRoot)) {
            filePath = filePath.substring(vaultRoot.length);
        }
        const parentPath = getParentPath(filePath);
        if (parentPath) {
            const parts = parentPath.split('/');
            for (let i = 1; i <= parts.length; i++) {
                folderPaths.add(parts.slice(0, i).join('/'));
            }
        }
    }

    if (folderPaths.size === 0) {
        return folderMap;
    }

    const sortedPaths = Array.from(folderPaths).sort((a, b) => {
        return a.split('/').length - b.split('/').length;
    });

    const existingFoldersIndex = new Map();
    for (const folder of game.folders.filter(f => f.type === 'Actor')) {
        const key = `${folder.folder?.id ?? null}:${folder.name}`;
        existingFoldersIndex.set(key, folder);
    }

    for (const path of sortedPaths) {
        const parts = path.split('/');
        const name = parts[parts.length - 1];
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
        const parentId = parentPath ? folderMap.get(parentPath)?.id : null;

        const lookupKey = `${parentId}:${name}`;
        const existing = existingFoldersIndex.get(lookupKey);

        if (existing) {
            folderMap.set(path, existing);
            continue;
        }

        const folder = await Folder.create({
            name,
            type: 'Actor',
            folder: parentId
        });

        if (folder) {
            folderMap.set(path, folder);
            createdFolderIds.push(folder.id);
            // Add to index so child folders can find it
            existingFoldersIndex.set(`${parentId}:${name}`, folder);
        }
    }

    return folderMap;
}

/**
 * Creates a configured pipeline for importing an Obsidian vault into Foundry.
 *
 * Pipeline phases:
 * 1. Filter files - Select files based on tree selection
 * 2. Prepare documents - Read file content and create MarkdownFile objects
 * 3. Prepare statblocks - Extract and parse statblock code blocks (conditional)
 * 4. Detect statblock conflicts - Check for existing actors (conditional)
 * 5. Import statblock actors - Create/update Actor documents (conditional)
 * 6. Extract frontmatter - Extract YAML frontmatter before markdown processing
 * 7. Extract callouts - Extract Obsidian callouts and replace with placeholders
 * 8. Convert line breaks - Convert single newlines to <br /> (conditional on strictLineBreaks)
 * 9. Replace callouts - Replace callout placeholders with rendered HTML
 * 10. Extract references - Extract links and assets from markdown
 * 11. Replace references - Replace references with placeholders
 * 12. Convert markdown - Convert markdown text to HTML
 * 13. Plan structure - Determine folder and journal entry structure
 * 14. Detect conflicts - Check for pages modified since last sync, prompt user
 * 15. Create documents - Create Foundry folders, journal entries, and pages
 * 16. Upload assets - Upload non-markdown files to data path (conditional)
 * 17. Resolve placeholders - Replace placeholders with actual UUIDs and paths
 * 18. Update content - Write final HTML content to journal pages
 *
 * @param {import('../domain/ImportOptions').default} importOptions - Import configuration
 * @param {import('showdown').Converter} showdownConverter - Markdown to HTML converter
 * @returns {import('../domain/PipelineConfig').default}
 */
export default function createImportPipeline(importOptions, showdownConverter) {
    const context = {
        importOptions,
        showdownConverter,
        originalVaultFiles: importOptions.vaultFiles,
        filesToParse: null,
        markdownFiles: null,
        structurePlan: null,
        callouts: new Map(),
        statblocks: [],
    };

    const phases = [
        new PhaseDefinition({
            name: 'filter-files',
            execute: async ctx => {
                if (!ctx.importOptions.vaultFileTree) {
                    ctx.filesToParse = ctx.originalVaultFiles;
                    return { filesSelected: ctx.originalVaultFiles.length };
                }

                const selectedPaths = collectSelectedPaths(ctx.importOptions.vaultFileTree);
                const selectedFiles = filterFilesBySelection(ctx.originalVaultFiles, selectedPaths);

                if (selectedFiles.length === 0) {
                    throw new Error('No files selected for import');
                }

                ctx.filesToParse = selectedFiles;
                return { filesSelected: selectedFiles.length };
            },
        }),

        new PhaseDefinition({
            name: 'prepare-documents',
            execute: async ctx => {
                const markdownFiles = await prepareFilesForImport(ctx.filesToParse);
                ctx.markdownFiles = markdownFiles;
                return { markdownFiles: markdownFiles.length };
            }
        }),

        new PhaseDefinition({
            name: 'prepare-statblocks',
            condition: ctx => {
                const result = ctx.importOptions.importStatblocks && StatblockAdapterRegistry.isAvailable();
                console.log('Obsidian Bridge | prepare-statblocks condition:', {
                    importStatblocks: ctx.importOptions.importStatblocks,
                    isAvailable: StatblockAdapterRegistry.isAvailable(),
                    result
                });
                return result;
            },
            execute: async ctx => {
                console.log('Obsidian Bridge | prepare-statblocks executing, files:', ctx.markdownFiles.length);
                let parsed = 0;

                for (const markdownFile of ctx.markdownFiles) {
                    const blocks = extractStatblocks(markdownFile.content);
                    console.log('Obsidian Bridge | File:', markdownFile.filePath, 'blocks found:', blocks.length);

                    for (const block of blocks) {
                        const statblock = parseStatblock(block.yaml, markdownFile.filePath);
                        ctx.statblocks.push(statblock);
                        parsed++;
                    }
                }

                console.log('Obsidian Bridge | prepare-statblocks complete, parsed:', parsed);
                return { parsed };
            }
        }),

        new PhaseDefinition({
            name: 'detect-statblock-conflicts',
            condition: ctx => ctx.importOptions.importStatblocks && StatblockAdapterRegistry.isAvailable(),
            execute: async ctx => {
                if (!ctx.statblocks?.length) {
                    console.log('Obsidian Bridge | detect-statblock-conflicts skipping, no statblocks');
                    return { toCreate: [], toUpdate: [], toSkip: [] };
                }
                console.log('Obsidian Bridge | detect-statblock-conflicts executing, statblocks:', ctx.statblocks.length);
                const toCreate = [];
                const toUpdate = [];
                const toSkip = [];

                for (const statblock of ctx.statblocks) {
                    const existingByFlag = game.actors.find(actor =>
                        actor.flags[MODULE_ID]?.sourceFile === statblock.filePath
                        && actor.name === statblock.name
                    );

                    if (existingByFlag) {
                        statblock._action = 'update';
                        statblock._existingActor = existingByFlag;
                        toUpdate.push(statblock.name);
                        continue;
                    }

                    const existingByName = game.actors.find(actor =>
                        actor.name === statblock.name
                        && !actor.flags[MODULE_ID]?.sourceFile
                    );

                    if (existingByName) {
                        statblock._action = 'skip';
                        toSkip.push(statblock.name);
                        continue;
                    }

                    statblock._action = 'create';
                    toCreate.push(statblock.name);
                }

                return { toCreate, toUpdate, toSkip };
            }
        }),

        new PhaseDefinition({
            name: 'import-statblock-actors',
            condition: ctx => ctx.importOptions.importStatblocks && StatblockAdapterRegistry.isAvailable(),
            execute: async ctx => {
                if (!ctx.statblocks?.length) {
                    console.log('Obsidian Bridge | import-statblock-actors skipping, no statblocks');
                    return {
                        created: [], updated: [], skipped: 0,
                        actors: [], createdActorIds: [], createdFolderIds: []
                    };
                }
                console.log('Obsidian Bridge | import-statblock-actors executing');
                const adapter = StatblockAdapterRegistry.getAdapter();
                console.log('Obsidian Bridge | adapter:', adapter ? 'found' : 'NOT FOUND');
                const created = [];
                const updated = [];
                let skipped = 0;
                const actors = [];
                const createdActorIds = [];
                const createdFolderIds = [];

                const vaultRoot = ctx.importOptions.vaultPath ? `${ctx.importOptions.vaultPath}/` : '';
                const folderMap = await createActorFolders(ctx.statblocks, vaultRoot, createdFolderIds);

                for (const statblock of ctx.statblocks) {
                    if (statblock._action === 'skip') {
                        skipped++;
                        continue;
                    }

                    if (statblock._action === 'update') {
                        const actor = await adapter.updateActor(statblock._existingActor, statblock);
                        updated.push(statblock.name);
                        actors.push({ actor, wasCreated: false });
                        continue;
                    }

                    let filePath = statblock.filePath;
                    if (vaultRoot && filePath.startsWith(vaultRoot)) {
                        filePath = filePath.substring(vaultRoot.length);
                    }
                    const folderPath = getParentPath(filePath);
                    const folder = folderPath ? folderMap.get(folderPath) : null;

                    const actor = await adapter.createActor(statblock, { folder });
                    created.push(statblock.name);
                    actors.push({ actor, wasCreated: true });
                    createdActorIds.push(actor.id);
                }

                return { created, updated, skipped, actors, createdActorIds, createdFolderIds };
            },
            rollback: async (ctx, result) => {
                for (const actorId of result?.createdActorIds || []) {
                    const actor = game.actors.get(actorId);
                    if (actor) {
                        await actor.delete();
                    }
                }

                for (const folderId of (result?.createdFolderIds || []).reverse()) {
                    const folder = game.folders.get(folderId);
                    if (folder) {
                        await folder.delete();
                    }
                }
            }
        }),

        new PhaseDefinition({
            name: 'extract-frontmatter',
            execute: async ctx => {
                let count = 0;
                for (const markdownFile of ctx.markdownFiles) {
                    const result = extractFrontmatter(markdownFile.content);
                    markdownFile.frontmatter = result.frontmatter;
                    markdownFile.content = result.content;
                    if (result.frontmatter !== null) {
                        count++;
                    }
                }
                return { frontmatterExtracted: count };
            }
        }),

        new PhaseDefinition({
            name: 'extract-callouts',
            execute: async ctx => {
                let totalCallouts = 0;
                for (const markdownFile of ctx.markdownFiles) {
                    const result = extractCallouts(markdownFile.content);
                    markdownFile.content = result.content;
                    ctx.callouts.set(markdownFile.filePath, result.callouts);
                    totalCallouts += result.callouts.length;
                }
                return { calloutsExtracted: totalCallouts };
            }
        }),

        new PhaseDefinition({
            name: 'escape-tag-headings',
            execute: async ctx => {
                let totalEscaped = 0;
                for (const markdownFile of ctx.markdownFiles) {
                    const mainResult = escapeTagHeadings(markdownFile.content);
                    markdownFile.content = mainResult.content;
                    totalEscaped += mainResult.escaped;

                    const callouts = ctx.callouts.get(markdownFile.filePath) || [];
                    for (const callout of callouts) {
                        const bodyResult = escapeTagHeadings(callout.body);
                        callout.body = bodyResult.content;
                        totalEscaped += bodyResult.escaped;
                    }
                }
                return { tagsEscaped: totalEscaped };
            }
        }),

        new PhaseDefinition({
            name: 'convert-line-breaks',
            execute: async ctx => {
                let filesConverted = 0;
                for (const markdownFile of ctx.markdownFiles) {
                    markdownFile.content = convertNewlinesToBr(markdownFile.content);
                    filesConverted++;
                }
                return { filesConverted };
            },
            condition: ctx => !ctx.importOptions.strictLineBreaks
        }),

        new PhaseDefinition({
            name: 'replace-callouts',
            execute: async ctx => {
                let totalReplaced = 0;
                for (const markdownFile of ctx.markdownFiles) {
                    const callouts = ctx.callouts.get(markdownFile.filePath) || [];
                    if (callouts.length > 0) {
                        markdownFile.content = replaceCalloutPlaceholders(
                            markdownFile.content,
                            callouts,
                            ctx.showdownConverter
                        );
                        totalReplaced += callouts.length;
                    }
                }
                return { calloutsReplaced: totalReplaced };
            }
        }),

        new PhaseDefinition({
            name: 'extract-references',
            execute: async ctx => {
                for (const markdownFile of ctx.markdownFiles) {
                    const links = extractLinkReferences(markdownFile.content);
                    const assets = extractAssetReferences(markdownFile.content);

                    markdownFile.links = links;
                    markdownFile.assets = assets;
                }

                return {
                    linksExtracted: ctx.markdownFiles.reduce((sum, f) => sum + f.links.length, 0),
                    assetsExtracted: ctx.markdownFiles.reduce((sum, f) => sum + f.assets.length, 0)
                };
            },
        }),

        new PhaseDefinition({
            name: 'replace-references',
            execute: async ctx => {
                for (const markdownFile of ctx.markdownFiles) {
                    const result = replaceWithPlaceholders(
                        markdownFile.content,
                        markdownFile.links,
                        markdownFile.assets
                    );

                    markdownFile.content = result.text;
                }

                return { filesTransformed: ctx.markdownFiles.length };
            },
        }),

        new PhaseDefinition({
            name: 'convert-markdown',
            execute: async ctx => {
                for (const markdownFile of ctx.markdownFiles) {
                    markdownFile.content = ctx.showdownConverter.makeHtml(markdownFile.content);
                }
                return { converted: ctx.markdownFiles.length };
            },
        }),

        new PhaseDefinition({
            name: 'plan-structure',
            execute: async ctx => {
                const structurePlan = planJournalStructure(ctx.markdownFiles, ctx.importOptions);
                ctx.structurePlan = structurePlan;
                return { structurePlan };
            },
        }),

        new PhaseDefinition({
            name: 'detect-conflicts',
            execute: async ctx => {
                const conflicts = await detectConflicts(ctx.structurePlan);

                if (conflicts.length === 0) {
                    return { conflicts: [], skipped: [] };
                }

                const skipped = await ConflictDialog.prompt(conflicts);
                filterSkippedFiles(ctx.markdownFiles, skipped);

                return { conflicts, skipped };
            },
        }),

        new PhaseDefinition({
            name: 'create-documents',
            execute: async ctx => {
                return await createJournals(
                    ctx.structurePlan,
                    ctx.markdownFiles,
                    ctx.importOptions.destinationFolder
                );
            },
            rollback: async (ctx, result) => {
                await rollbackJournals(
                    result.createdPages,
                    result.createdEntries,
                    result.createdFolders
                );
            },
        }),

        new PhaseDefinition({
            name: 'upload-assets',
            execute: async ctx => {
                return await uploadAssets(ctx.markdownFiles, ctx.originalVaultFiles, ctx.importOptions);
            },
            rollback: async (ctx, result) => {
                await rollbackUploads(result.uploadedPaths);
            },
            condition: ctx => ctx.importOptions.importAssets,
        }),

        new PhaseDefinition({
            name: 'resolve-placeholders',
            execute: async (ctx, phaseResults) => {
                const uploadResult = phaseResults?.get('upload-assets');
                const nonMarkdownFiles = uploadResult?.nonMarkdownFiles || [];
                resolvePlaceholders(ctx.markdownFiles, nonMarkdownFiles);
                return { placeholdersResolved: true };
            },
        }),

        new PhaseDefinition({
            name: 'update-content',
            execute: async ctx => {
                return await updateContent(ctx.markdownFiles);
            },
            rollback: async (ctx, result) => {
                await rollbackUpdates(result.updatedPages);
            },
        }),
    ];

    return new PipelineConfig({ phases, context });
}
