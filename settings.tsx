/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { OptionType, PluginNative } from "@utils/types";
import { showToast, TextInput, useEffect, useState } from "@webpack/common";

export const Native = (VencordNative?.pluginHelpers?.DiscordOpsec ?? null) as PluginNative<typeof import("./native")> | null;

function ApiKeySetting() {
    const [hasKey, setHasKey] = useState<boolean | null>(null);
    const [value, setValue] = useState("");

    useEffect(() => {
        Native?.hasApiKey().then(setHasKey, () => setHasKey(false));
    }, []);

    if (!Native) return (
        <Paragraph>VirusTotal lookups need the desktop client (Discord desktop or Vesktop). They are unavailable on the web.</Paragraph>
    );

    async function save() {
        const res = await Native!.setApiKey(value.trim());
        if (res.ok) {
            setValue("");
            setHasKey(value.trim().length > 0);
            showToast({ text: value.trim() ? "VirusTotal key saved" : "VirusTotal key removed", variant: "success" });
        } else showToast({ text: res.error, variant: "critical" });
    }

    return (
        <div className="vc-opsec-key">
            <Heading>VirusTotal API key</Heading>
            <Paragraph>
                Free key from virustotal.com (account → API key). It is encrypted with your OS keychain and kept out of
                Vencord settings and cloud sync. {hasKey === true ? "A key is saved." : hasKey === false ? "No key saved." : ""}
            </Paragraph>
            <div className="vc-opsec-key-row">
                <TextInput
                    type="password"
                    value={value}
                    onChange={setValue}
                    placeholder={hasKey ? "Enter a new key to replace the saved one" : "Paste API key"}
                />
                <Button size="small" onClick={save} disabled={!value.trim()}>Save</Button>
                {hasKey && <Button size="small" variant="dangerSecondary" onClick={() => { setValue(""); Native!.setApiKey("").then(() => setHasKey(false)); }}>Remove</Button>}
            </div>
        </div>
    );
}

export const enum FailurePolicy { Block = "block", Allow = "allow" }
export const enum ScanMode { Auto = "auto", Manual = "manual" }
export const enum ScanScope { All = "all", Dms = "dms" }
export const enum LinkMode { Suspicious = "suspicious", AllExternal = "all" }

export const DEFAULT_RISKY_EXTENSIONS =
    "exe, msi, msix, appx, scr, com, pif, bat, cmd, ps1, psm1, vbs, vbe, js, jse, wsf, wsh, hta, cpl, dll, sys, lnk, reg, jar, " +
    "apk, xapk, dmg, pkg, app, sh, deb, rpm, appimage, run, iso, img, vhd, vhdx, zip, rar, 7z, tar, gz, cab, " +
    "docm, xlsm, pptm, dotm, xlam, one, chm, py, pyw";

export const settings = definePluginSettings({
    stripMetadata: {
        type: OptionType.BOOLEAN,
        description: "Remove EXIF/XMP/GPS and other metadata from images before they are uploaded",
        default: true
    },
    stripVideoMetadata: {
        type: OptionType.BOOLEAN,
        description: "Also scrub metadata (location, device, dates) from MP4/MOV videos",
        default: true
    },
    keepOrientation: {
        type: OptionType.BOOLEAN,
        description: "Keep the EXIF rotation flag so photos aren't shown sideways (nothing else is kept)",
        default: true
    },
    keepColorProfile: {
        type: OptionType.BOOLEAN,
        description: "Keep embedded ICC color profiles (affects colors only)",
        default: true
    },
    metadataFailure: {
        type: OptionType.SELECT,
        description: "If metadata can't be removed from a file",
        options: [
            { label: "Block the upload", value: FailurePolicy.Block, default: true },
            { label: "Upload the original and warn me", value: FailurePolicy.Allow }
        ]
    },
    metadataToast: {
        type: OptionType.BOOLEAN,
        description: "After uploading, show a notification with a button listing what was removed (GPS, camera, date taken...)",
        default: false
    },

    blockCamera: {
        type: OptionType.BOOLEAN,
        description: "Block the webcam inside Discord (video calls, camera previews, camera go-live)",
        default: true
    },

    scanAttachments: {
        type: OptionType.BOOLEAN,
        description: "Warn about executables and other risky attachments",
        default: true
    },
    vtApiKey: {
        type: OptionType.COMPONENT,
        component: ApiKeySetting
    },
    scanMode: {
        type: OptionType.SELECT,
        description: "VirusTotal hash lookups",
        options: [
            { label: "Automatically for risky attachments I see", value: ScanMode.Auto, default: true },
            { label: "Only when I click Scan", value: ScanMode.Manual }
        ]
    },
    scanScope: {
        type: OptionType.SELECT,
        description: "Automatic lookups apply to",
        options: [
            { label: "DMs and servers", value: ScanScope.All, default: true },
            { label: "DMs only", value: ScanScope.Dms }
        ]
    },
    riskyExtensions: {
        type: OptionType.STRING,
        description: "File extensions treated as risky (comma separated)",
        default: DEFAULT_RISKY_EXTENSIONS
    },
    maxHashSizeMb: {
        type: OptionType.NUMBER,
        description: "Largest attachment to download for hashing (MB)",
        default: 50
    },
    vtRequestsPerMinute: {
        type: OptionType.NUMBER,
        description: "VirusTotal requests per minute (free tier allows 4)",
        default: 4
    },

    linkWarnings: {
        type: OptionType.BOOLEAN,
        description: "Warn before opening suspicious links",
        default: true
    },
    linkMode: {
        type: OptionType.SELECT,
        description: "When to show the link warning",
        options: [
            { label: "Only for suspicious links", value: LinkMode.Suspicious, default: true },
            { label: "For every external link", value: LinkMode.AllExternal }
        ]
    },
    blocklistAntiScam: {
        type: OptionType.BOOLEAN,
        description: "Use the Discord-AntiScam domain list (~37k domains, refreshed daily, desktop only)",
        default: true
    },
    blocklistPhishingArmy: {
        type: OptionType.BOOLEAN,
        description: "Use the Phishing Army list (~150k domains, ~10 MB RAM, desktop only)",
        default: false
    },
    trustedDomains: {
        type: OptionType.STRING,
        description: "Domains you never want warnings for (comma separated, subdomains included)",
        default: ""
    }
});

export function parseList(value: string) {
    return value.split(/[\s,]+/).map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
}
