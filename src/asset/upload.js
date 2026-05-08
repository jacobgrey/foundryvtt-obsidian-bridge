import NonMarkdownFile from '../domain/NonMarkdownFile';
import { resolveAssetFile } from '../vault/find';
import { collectRequiredDirectories } from '../journal/collect';

/**
 * Upload assets to Foundry data directory
 *
 * Dependencies: Foundry (FilePicker API)
 */

/**
 * Uploads non-markdown assets referenced in imported markdown files.
 * Only uploads assets from MarkdownFiles that were actually imported (have foundryPageUuid).
 *
 * Per-asset failures (e.g. Foundry rejecting a disallowed file type) are caught and
 * collected as `failedAssets` rather than aborting the import. Successfully uploaded
 * assets are still tracked in `uploadedPaths` for rollback.
 *
 * @param {MarkdownFile[]} markdownFiles - All markdown files (will filter to imported only)
 * @param {FileList} vaultFiles - Original FileList from vault selection
 * @param {ImportOptions} importOptions - Import configuration (dataPath)
 * @returns {Promise<{nonMarkdownFiles: NonMarkdownFile[], uploadedPaths: string[], failedAssets: Array<{path: string, reason: string}>}>}
 */
export async function uploadAssets(markdownFiles, vaultFiles, importOptions) {
    const importedFiles = markdownFiles.filter(mf => mf.foundryPageUuid);
    const uniqueAssetPaths = collectUniqueAssetPaths(importedFiles);

    if (uniqueAssetPaths.size === 0) {
        return { nonMarkdownFiles: [], uploadedPaths: [], failedAssets: [] };
    }

    const failedAssets = [];
    const resolvedAssets = [];
    for (const assetPath of uniqueAssetPaths) {
        const vaultFile = resolveAssetFile(assetPath, vaultFiles);

        if (!vaultFile) {
            console.warn(`Asset referenced but not found in vault: ${assetPath}`);
            failedAssets.push({ path: assetPath, reason: 'not found in vault' });
            continue;
        }

        const parts = vaultFile.webkitRelativePath.split('/');
        const vaultRelativePath = parts.slice(1).join('/');

        resolvedAssets.push({ vaultFile, vaultRelativePath });
    }

    const vaultPaths = resolvedAssets.map(asset => asset.vaultRelativePath);
    const directories = collectRequiredDirectories(vaultPaths, importOptions.dataPath);
    await ensureDirectoriesExist(directories);

    const uploadResults = await Promise.all(
        resolvedAssets.map(async ({ vaultFile, vaultRelativePath }) => {
            const pathParts = vaultRelativePath.split('/');
            pathParts.pop();
            const directory = pathParts.length > 0
                ? `${importOptions.dataPath}/${pathParts.join('/')}`
                : importOptions.dataPath;

            try {
                const response = await FilePicker.upload('data', directory, vaultFile, {}, { notify: false });

                if (!response || !response.path) {
                    return { kind: 'failed', path: vaultRelativePath, reason: 'upload returned no path' };
                }

                const nonMarkdownFile = new NonMarkdownFile({ filePath: vaultRelativePath });
                nonMarkdownFile.foundryDataPath = response.path;

                return { kind: 'success', nonMarkdownFile, uploadedPath: response.path };
            } catch (error) {
                const reason = error?.message || String(error);
                console.warn(`Skipping asset that failed to upload: ${vaultRelativePath} (${reason})`);
                return { kind: 'failed', path: vaultRelativePath, reason };
            }
        })
    );

    const nonMarkdownFiles = [];
    const uploadedPaths = [];
    for (const result of uploadResults) {
        if (result.kind === 'success') {
            nonMarkdownFiles.push(result.nonMarkdownFile);
            uploadedPaths.push(result.uploadedPath);
        } else {
            failedAssets.push({ path: result.path, reason: result.reason });
        }
    }

    return { nonMarkdownFiles, uploadedPaths, failedAssets };
}

/**
 * Deletes uploaded asset files from Foundry's data directory.
 *
 * @param {string[]} uploadedPaths - Array of file paths to delete
 */
export async function rollbackUploads(uploadedPaths) {
    for (const path of uploadedPaths.reverse()) {
        try {
            await FilePicker.delete('data', path, { notify: false });
        } catch (error) {
            console.error(`Failed to rollback asset ${path}:`, error);
        }
    }
}


/**
 * Collects unique asset paths from markdown files.
 * Aggregates all asset references and removes duplicates.
 *
 * @param {MarkdownFile[]} markdownFiles - Array of markdown files containing asset references
 * @returns {Set<string>} Set of unique asset paths
 */
function collectUniqueAssetPaths(markdownFiles) {
    const uniquePaths = new Set();

    for (const markdownFile of markdownFiles) {
        for (const asset of markdownFile.assets) {
            uniquePaths.add(asset.obsidian);
        }
    }

    return uniquePaths;
}

async function ensureDirectoriesExist(directories) {
    for (const directory of directories) {
        try {
            await FilePicker.browse('data', directory);
        } catch (error) {
            try {
                await FilePicker.createDirectory('data', directory);
            } catch (createError) {
                console.warn(`Failed to create directory ${directory}:`, createError);
            }
        }
    }
}
