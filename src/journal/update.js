import { id as MODULE_ID } from '../../module.json';

/**
 * Update journal page content in Foundry
 *
 * Dependencies: Foundry (fromUuidSync, page.update APIs)
 */

const OWNERSHIP_INHERIT = -1;
const OWNERSHIP_NONE = 0;
const OWNERSHIP_LIMITED = 1;

export async function updateContent(markdownFiles, createResult = null) {
    if (!Array.isArray(markdownFiles) || markdownFiles.length === 0) {
        return { updatedPages: [], updatedEntries: [] };
    }

    const createdPageUuids = new Set(
        (createResult?.createdPages ?? []).map(({ page }) => page.uuid)
    );
    const createdEntryIds = new Set(
        (createResult?.createdEntries ?? []).map(entry => entry.id)
    );

    const pageJobs = collectPageJobs(markdownFiles);
    const { updatedEntries, elevatedEntryIds } = await elevateExistingEntries(
        pageJobs,
        createdEntryIds
    );

    const updatedPages = [];

    for (const job of pageJobs) {
        const result = await applyPageUpdate(job, createdPageUuids, elevatedEntryIds);
        if (result) {
            updatedPages.push(result);
        }
    }

    return { updatedPages, updatedEntries };
}

/**
 * Flattens markdownFiles (and their splitPages, when present) into a list of
 * page-update jobs. Each job carries the resolved page reference and the
 * payload values for that single page.
 */
function collectPageJobs(markdownFiles) {
    const jobs = [];

    for (const markdownFile of markdownFiles) {
        if (markdownFile.splitPages) {
            for (let i = 0; i < markdownFile.splitPages.length; i++) {
                const splitPage = markdownFile.splitPages[i];
                const isFirstPage = i === 0;
                jobs.push(buildJob(
                    splitPage.foundryPageUuid,
                    splitPage.content,
                    isFirstPage ? markdownFile.frontmatter : null,
                    markdownFile.filePath,
                    markdownFile.pagePermission
                ));
            }
        } else {
            jobs.push(buildJob(
                markdownFile.foundryPageUuid,
                markdownFile.content,
                markdownFile.frontmatter,
                markdownFile.filePath,
                markdownFile.pagePermission
            ));
        }
    }

    return jobs;
}

function buildJob(uuid, content, frontmatter, filePath, pagePermission) {
    if (!uuid) {
        return { uuid: null, content, frontmatter, filePath, pagePermission, page: null };
    }
    const page = fromUuidSync(uuid);
    if (!page) {
        throw new Error(`Page not found for UUID: ${uuid} (${filePath})`);
    }
    return { uuid, content, frontmatter, filePath, pagePermission, page };
}

/**
 * Raises existing parent entries to LIMITED when any constituent page opts in
 * and the entry currently sits below LIMITED. Newly created entries are skipped
 * (their ownership was set in the create payload). "Only raise, never lower" —
 * an entry whose current default >= LIMITED is left alone.
 */
async function elevateExistingEntries(pageJobs, createdEntryIds) {
    const entryToOptIn = new Map();

    for (const job of pageJobs) {
        if (!job.page?.parent) {
            continue;
        }
        const entry = job.page.parent;
        const current = entryToOptIn.get(entry) ?? false;
        entryToOptIn.set(entry, current || job.pagePermission != null);
    }

    const updatedEntries = [];
    const elevatedEntryIds = new Set();

    for (const [entry, anyOptIn] of entryToOptIn) {
        if (!anyOptIn) {
            continue;
        }
        if (createdEntryIds.has(entry.id)) {
            continue;
        }
        const currentDefault = entry.ownership?.default ?? OWNERSHIP_NONE;
        if (currentDefault >= OWNERSHIP_LIMITED) {
            continue;
        }

        const originalOwnershipDefault = entry.ownership?.default ?? OWNERSHIP_NONE;
        await entry.update({ 'ownership.default': OWNERSHIP_LIMITED });
        updatedEntries.push({ entry, originalOwnershipDefault });
        elevatedEntryIds.add(entry.id);
    }

    return { updatedEntries, elevatedEntryIds };
}

async function applyPageUpdate(job, createdPageUuids, elevatedEntryIds) {
    if (!job.uuid) {
        console.warn(`Skipping page without UUID: ${job.filePath}`);
        return null;
    }

    const { page, content, frontmatter, pagePermission } = job;

    const originalContent = page.text?.content || '';
    const originalFrontmatter = page.flags?.[MODULE_ID]?.frontmatter ?? null;
    const originalLastSyncedAt = page.flags?.[MODULE_ID]?.lastSyncedAt ?? null;
    const originalOwnershipDefault = page.ownership?.default ?? OWNERSHIP_INHERIT;

    const updatePayload = {
        'text.content': content,
        [`flags.${MODULE_ID}.frontmatter`]: frontmatter,
        [`flags.${MODULE_ID}.lastSyncedAt`]: Date.now()
    };

    let ownershipTouched = false;
    const ownershipDefault = decidePageOwnership({
        page,
        pagePermission,
        wasJustCreated: createdPageUuids.has(job.uuid),
        parentJustElevated: elevatedEntryIds.has(page.parent?.id)
    });
    if (ownershipDefault !== null) {
        updatePayload['ownership.default'] = ownershipDefault;
        ownershipTouched = true;
    }

    await page.update(updatePayload);

    return {
        page,
        originalContent,
        originalFrontmatter,
        originalLastSyncedAt,
        originalOwnershipDefault: ownershipTouched ? originalOwnershipDefault : null
    };
}

/**
 * Resolves the ownership.default value for a single page. Returns null when
 * ownership should not be touched.
 *
 * Priority:
 *   1. show-players opt-in → write per frontmatter
 *   2. Newly created page → ownership already set at create time, skip
 *   3. Page currently inheriting AND parent was just elevated → write NONE to
 *      break inheritance and prevent title leakage
 *   4. Otherwise → leave alone (preserves manual GM ownership config)
 */
function decidePageOwnership({ page, pagePermission, wasJustCreated, parentJustElevated }) {
    if (pagePermission != null) {
        return pagePermission;
    }
    if (wasJustCreated) {
        return null;
    }
    const currentDefault = page.ownership?.default ?? OWNERSHIP_INHERIT;
    if (currentDefault === OWNERSHIP_INHERIT && parentJustElevated) {
        return OWNERSHIP_NONE;
    }
    return null;
}

export async function rollbackUpdates(updatedPages, updatedEntries = []) {
    if (Array.isArray(updatedPages) && updatedPages.length > 0) {
        const reversedPages = [...updatedPages].reverse();

        for (const record of reversedPages) {
            const {
                page,
                originalContent,
                originalFrontmatter,
                originalLastSyncedAt,
                originalOwnershipDefault
            } = record;
            try {
                const payload = {
                    'text.content': originalContent,
                    [`flags.${MODULE_ID}.frontmatter`]: originalFrontmatter,
                    [`flags.${MODULE_ID}.lastSyncedAt`]: originalLastSyncedAt
                };
                if (originalOwnershipDefault !== null && originalOwnershipDefault !== undefined) {
                    payload['ownership.default'] = originalOwnershipDefault;
                }
                await page.update(payload);
            } catch (error) {
                console.error(`Failed to rollback page ${page.uuid}:`, error);
            }
        }
    }

    if (Array.isArray(updatedEntries) && updatedEntries.length > 0) {
        const reversedEntries = [...updatedEntries].reverse();

        for (const { entry, originalOwnershipDefault } of reversedEntries) {
            try {
                await entry.update({ 'ownership.default': originalOwnershipDefault });
            } catch (error) {
                console.error(`Failed to rollback entry ${entry.uuid ?? entry.id}:`, error);
            }
        }
    }
}
