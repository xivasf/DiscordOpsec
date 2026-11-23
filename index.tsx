/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Paragraph } from "@components/Paragraph";
import definePlugin from "@utils/types";

import { AttachmentWarnings } from "./attachments";
import { enforceCameraOff, gateVideo, markStoreGatePatched, startCameraGuard, status as cameraStatus, stopCameraGuard } from "./camera";
import { onLinkClick, prepareBlocklists } from "./links";
import { Native, settings } from "./settings";
import { beforeUpload } from "./uploads";

function StatusPanel() {
    const s = settings.use(["blockCamera"]);
    const on = (v: boolean) => v ? "active" : "NOT active";
    return (
        <div className="vc-opsec-status">
            <Paragraph>
                Camera block {s.blockCamera ? "enabled" : "disabled"}. Store gate: {on(cameraStatus.storeGate)}, action filter: {on(cameraStatus.interceptor)},
                engine guard: {on(cameraStatus.engineGuard)}, getUserMedia guard: {on(cameraStatus.gumGuard)}.
            </Paragraph>
            <Paragraph>
                VirusTotal and blocklists: {Native ? "available" : "unavailable (web client)"}. Only file hashes are sent to VirusTotal automatically;
                links are sent only when you press "Check URL on VirusTotal".
            </Paragraph>
        </div>
    );
}

export default definePlugin({
    name: "DiscordOpsec",
    description: "Strips upload metadata, blocks the webcam, checks risky attachments on VirusTotal and warns about suspicious links",
    authors: [
        {
            name: "Seekehr",
            id: 535439695849455629n
        }
    ],
    tags: ["Privacy", "Utility"],
    settings,
    settingsAboutComponent: StatusPanel,

    patches: [
        {
            // CloudUpload.upload(): runs after Discord's HEIC/WebP conversions, before the upload URL is requested.
            find: "Requesting upload url for",
            replacement: {
                match: /(?=let \i=await \i\.getUploadPayload\(this\),\i=\(0,\i\.\i\)\(this\.item\.target\);)/,
                replace: "if(!await $self.beforeUpload(this))return;"
            }
        },
        {
            find: "MediaEngineStore go live",
            group: true,
            replacement: [
                {
                    // The one place the store hands a camera device to the voice engine.
                    match: /(?<=\i=\()(\i)=(\i)(?=\)\?\i\(\i,\i\):\i\.\i,\i\.setVideoInputDevice\()/,
                    replace: "$1=$self.gateVideo($2)"
                },
                {
                    // Camera used as a Go Live source.
                    match: /null!=\i\.cameraSource&&(?=\i\.setGoLiveSource\(\{cameraDescription:)/,
                    replace: "$&$self.gateVideo(!0)&&"
                },
                {
                    // Lets us report honestly whether the gate above was applied.
                    match: /static displayName="MediaEngineStore";/,
                    replace: "$&static _opsec=$self.markStoreGatePatched();"
                }
            ]
        },
        {
            // Discord's link click handler (same one OpenInApp uses). Kept short so OpenInApp's patch still matches.
            find: "trackAnnouncementMessageLinkClicked({",
            replacement: {
                match: /function \i\(\i,\i\)\{(?=.{0,200}trusted:)/,
                // Discord shadows the function's own name with a local variable, so links.tsx looks the handler up via webpack.
                replace: "$&if($self.onLink(arguments))return;"
            }
        }
    ],

    beforeUpload,
    gateVideo,
    markStoreGatePatched,
    onLink: onLinkClick,

    flux: {
        // Watchdog for the camera block in case video got enabled through a path we didn't anticipate.
        MEDIA_ENGINE_SET_VIDEO_ENABLED: enforceCameraOff,
        VOICE_CHANNEL_SELECT: enforceCameraOff,
        RTC_CONNECTION_STATE: enforceCameraOff
    },

    // Vencord wraps accessories in an ErrorBoundary already.
    renderMessageAccessory: props => props.isMessageSnapshot ? null : <AttachmentWarnings message={props.message} />,

    start() {
        startCameraGuard();
        prepareBlocklists();
    },

    stop() {
        stopCameraGuard();
    }
});
