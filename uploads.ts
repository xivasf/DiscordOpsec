/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { CloudUpload } from "@vencord/discord-types";
import { showToast } from "@webpack/common";

import { stripMetadata } from "./metadata";
import { reportStripped } from "./removedDialog";
import { FailurePolicy, settings } from "./settings";

const logger = new Logger("DiscordOpsec");
const PROCESSED = Symbol("DiscordOpsec.processed");

type Upload = CloudUpload & {
    [PROCESSED]?: Blob;
    _originalMd5?: unknown;
    setFilename?(name: string): void;
    handleError?(code: unknown): void;
};

/**
 * Runs inside CloudUpload.upload() after Discord's own conversions and before the upload URL is requested.
 * Returning false aborts the upload (Discord shows it as failed and offers a retry).
 */
export async function beforeUpload(upload: Upload): Promise<boolean> {
    if (!settings.store.stripMetadata) return true;

    const { item } = upload;
    const file = item?.file;
    if (!(file instanceof File) || upload[PROCESSED] === file) return true;

    try {
        const result = await stripMetadata(file, {
            keepColorProfile: settings.store.keepColorProfile,
            keepOrientation: settings.store.keepOrientation,
            videos: settings.store.stripVideoMetadata
        });

        if (result.changed) {
            item.file = result.file;
            upload.currentSize = result.file.size;
            if (result.file.name !== file.name) {
                if (typeof upload.setFilename === "function") upload.setFilename(result.file.name);
                else upload.filename = result.file.name;
            }
            if (settings.store.metadataToast) reportStripped({ fileName: result.file.name, removed: result.removed });
        }

        // Discord sends an MD5 of the pre-conversion original (e.g. HEIC) as a header. That's a fingerprint of the original file.
        upload._originalMd5 = null;
        upload[PROCESSED] = item.file;
        return true;
    } catch (e) {
        logger.error("Metadata removal failed for", file.name, e);

        if (settings.store.metadataFailure === FailurePolicy.Allow) {
            showToast({ text: `Couldn't remove metadata from ${file.name}. Uploaded the original.`, variant: "critical" });
            upload[PROCESSED] = file;
            return true;
        }

        showToast({ text: `Blocked upload of ${file.name}: metadata could not be removed`, variant: "critical" });
        if (typeof upload.handleError === "function") upload.handleError(undefined);
        else upload.cancel();
        return false;
    }
}
