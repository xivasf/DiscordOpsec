/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Modal, openModal } from "@webpack/common";

import type { RemovedItem } from "./metadata";

export interface StripReport {
    fileName: string;
    removed: RemovedItem[];
}

const WHY: Record<string, string> = {
    "GPS location": "Where it was taken, often accurate to a few meters",
    "GPS data": "Location related fields",
    "Camera": "The make and model of your device",
    "Date taken": "Exactly when it was taken",
    "Camera serial number": "Ties every photo to the same physical device",
    "Lens": "The lens used",
    "Software": "The OS or app version that saved it",
    "Author name": "A name stored in the file",
    "Camera owner name": "A name stored in the file",
    "Copyright": "Often contains a name",
    "Unique image ID": "Can link copies of the same photo",
    "Embedded thumbnail": "A small preview that can show the original, uncropped image",
    "EXIF": "Camera data that couldn't be broken down further",
    "XMP": "Editing history, app data, sometimes location",
    "IPTC/Photoshop data": "Captions, names, keywords, sometimes location",
    "Comment": "Free text written into the file",
    "Text fields": "Text stored in the image (author, software, descriptions)",
    "Modification time": "When the file was last changed",
    "Color profile": "Color calibration data, sometimes names the device",
    "Extra images (MPF)": "Extra images bundled with the photo (depth maps, HDR)",
    "Trailing data after the image": "Hidden data appended by the camera or an app",
    "Vendor data": "Manufacturer specific data",
    "Application data": "Data written by the app that made the file",
    "Device make/model": "The device that recorded it",
    "Recording date": "When it was recorded",
    "Video metadata tags": "Other metadata stored in the video",
    "All metadata": "The format couldn't be cleaned in place, so the image was converted"
};

function RemovedDetails({ reports }: { reports: StripReport[]; }) {
    return (
        <div className="vc-opsec-removed">
            {reports.map((r, i) => (
                <section key={i}>
                    {reports.length > 1 && <h3 className="vc-opsec-removed-file">{r.fileName}</h3>}
                    <table>
                        <tbody>
                            {r.removed.map(item => (
                                <tr key={item.name}>
                                    <td className="vc-opsec-removed-name">{item.name}</td>
                                    <td>
                                        {item.value && <div className="vc-opsec-removed-value">{item.value}</div>}
                                        {WHY[item.name] && <div className="vc-opsec-note">{WHY[item.name]}</div>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            ))}
        </div>
    );
}

export function openRemovedDialog(reports: StripReport[]) {
    openModal(modalProps => (
        <Modal
            {...modalProps}
            title="Metadata removed"
            subtitle={reports.length === 1
                ? `${reports[0].fileName} was cleaned before it was uploaded.`
                : `${reports.length} files were cleaned before they were uploaded.`}
            actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}
        >
            <RemovedDetails reports={reports} />
        </Modal>
    ));
}

let pending: StripReport[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Collects reports from one batch of uploads and shows a single notification for them. */
export function reportStripped(report: StripReport) {
    pending.push(report);
    clearTimeout(timer);
    timer = setTimeout(() => {
        const reports = pending;
        pending = [];

        const names = [...new Set(reports.flatMap(r => r.removed.map(i => i.name)))];
        const summary = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
        const target = reports.length === 1 ? reports[0].fileName : `${reports.length} files`;

        showNotification({
            title: "Metadata removed",
            body: `${target}: ${summary}. Click for details.`,
            richBody: (
                <div className="vc-opsec-notif">
                    <div><strong>{target}</strong>: {summary}</div>
                    <span className="vc-opsec-btn">View details</span>
                </div>
            ),
            onClick: () => openRemovedDialog(reports)
        });
    }, 500);
}
