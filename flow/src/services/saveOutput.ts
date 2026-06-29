/**
 * Shared post-drop save.
 * Respects the gallery settings: "Save location" (ask | beside | folder) and
 * "Open folder after saving". Falls back to a browser download (single file, or
 * a zip for multiple) when the Electron bridge isn't available.
 */

export type SaveItem = {
    /** Output filename, e.g. "photo_compressed.jpg" */
    name: string;
    /** Result URL — a data:, blob: or http(s): URL. Converted to bytes for saving. */
    url: string;
    /** Path of the source file, used by "Next to original". null if unknown. */
    originalPath?: string | null;
};

async function toDataUrl(url: string): Promise<string> {
    if (url.startsWith('data:')) return url;
    const blob = await (await fetch(url)).blob();
    return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

function browserDownload(href: string, name: string) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
}

/** Save one or more results, honoring the user's Save-location/open-folder settings. */
export async function saveOutputs(items: SaveItem[], fallbackZipName = 'output'): Promise<void> {
    if (!items.length) return;
    const el = (window as any).electron;

    const built = await Promise.all(items.map(async (i) => ({
        name: i.name,
        dataUrl: await toDataUrl(i.url),
        originalPath: i.originalPath ?? null,
    })));

    if (el?.saveOutput) {
        const mode = (await el.getSetting?.('saveMode')) || 'folder';
        const openFolder = (await el.getSetting?.('openFolderAfterSave')) !== false;
        await el.saveOutput({ items: built, mode, openFolder });
        return;
    }

    // --- Fallback: browser download ---
    if (built.length === 1) {
        browserDownload(built[0].dataUrl, built[0].name);
        return;
    }
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const b of built) zip.file(b.name, await (await fetch(b.dataUrl)).blob());
    const content = await zip.generateAsync({ type: 'blob' });
    const objUrl = URL.createObjectURL(content);
    browserDownload(objUrl, `${fallbackZipName}.zip`);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}
