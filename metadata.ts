/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Lossless metadata removal. Images are rebuilt from their original segments/chunks
// so pixel data is never re-encoded. Videos have their metadata boxes overwritten
// in place with zeroed "free" boxes so sample offsets stay valid.
// Every strip function records a short human readable label for what it dropped.

export interface StripOptions {
    keepColorProfile: boolean;
    keepOrientation: boolean;
    videos: boolean;
}

export interface StripResult {
    file: File;
    changed: boolean;
    /** What was removed, in the order it was found */
    removed: RemovedItem[];
}

export interface RemovedItem {
    /** e.g. "GPS location", "Camera", "XMP" */
    name: string;
    /** The value that was stored, when it is short and readable (e.g. "Apple iPhone 15 Pro") */
    value?: string;
}

type Found = Map<string, string | undefined>;

const add = (found: Found, name: string, value?: string) => {
    if (!found.has(name)) found.set(name, value);
};

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const u16be = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32be = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
const u32le = (b: Uint8Array, p: number) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

function includesBytes(b: Uint8Array, s: string) {
    const first = s.charCodeAt(0);
    outer: for (let i = b.indexOf(first); i !== -1 && i + s.length <= b.length; i = b.indexOf(first, i + 1)) {
        for (let j = 1; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer;
        return true;
    }
    return false;
}

class MalformedError extends Error { }
const malformed = (what: string): never => { throw new MalformedError(`Malformed ${what}`); };

// ---------- EXIF (TIFF structure) ----------

/** Records what an EXIF block contains and returns its orientation (0 if none). Never throws. */
function describeExif(t: Uint8Array, found: Found): number {
    const before = found.size;
    let orientation = 0;
    try {
        if (t.length < 8) throw 0;
        const le = t[0] === 0x49;
        const r16 = (p: number) => p + 2 <= t.length ? (le ? t[p] | (t[p + 1] << 8) : u16be(t, p)) : 0;
        const r32 = (p: number) => p + 4 <= t.length ? (le ? u32le(t, p) : u32be(t, p)) : 0;

        const readIfd = (off: number) => {
            const entries = new Map<number, number>();
            if (!off || off + 2 > t.length) return { entries, next: 0 };
            const n = Math.min(r16(off), 512);
            for (let i = 0; i < n; i++) {
                const e = off + 2 + i * 12;
                if (e + 12 > t.length) break;
                entries.set(r16(e), e);
            }
            return { entries, next: r32(off + 2 + n * 12) };
        };
        const str = (m: Map<number, number>, tag: number) => {
            const e = m.get(tag);
            if (e == null) return "";
            const count = r32(e + 4);
            const at = count > 4 ? r32(e + 8) : e + 8;
            if (!count || at + count > t.length) return "";
            return ascii(t, at, Math.min(count, 80)).replace(/\0[\s\S]*$/, "").trim();
        };
        const sub = (m: Map<number, number>, tag: number) => m.has(tag) ? readIfd(r32(m.get(tag)! + 8)).entries : new Map<number, number>();

        const ifd0 = readIfd(r32(4));
        const tags = ifd0.entries;
        const exif = sub(tags, 0x8769);
        const gps = sub(tags, 0x8825);
        if (tags.has(0x0112)) orientation = r16(tags.get(0x0112)! + 8);

        if (gps.has(2) || gps.has(4)) add(found, "GPS location");
        else if (gps.size) add(found, "GPS data");

        const make = str(tags, 0x010F);
        const model = str(tags, 0x0110);
        if (make || model)
            add(found, "Camera", model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(" "));

        const date = str(exif, 0x9003) || str(tags, 0x0132);
        if (date) add(found, "Date taken", date);
        if (str(exif, 0xA431)) add(found, "Camera serial number");
        const lens = str(exif, 0xA434);
        if (lens) add(found, "Lens", lens);
        const software = str(tags, 0x0131);
        if (software) add(found, "Software", software);
        if (str(tags, 0x013B)) add(found, "Author name");
        if (str(tags, 0x8298)) add(found, "Copyright");
        if (str(exif, 0xA420)) add(found, "Unique image ID");
        if (str(exif, 0xA430)) add(found, "Camera owner name");
        if (ifd0.next) add(found, "Embedded thumbnail");
    } catch { }
    if (found.size === before) add(found, "EXIF");
    return orientation;
}

// ---------- JPEG ----------

// Minimal APP1 carrying only the Orientation tag, so phone photos don't end up sideways.
function orientationApp1(o: number) {
    return new Uint8Array([
        0xFF, 0xE1, 0x00, 0x22,
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // Exif\0\0
        0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, // MM, IFD0 @ 8
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    ]);
}

function keepJpegSegment(marker: number, seg: Uint8Array, opts: StripOptions) {
    if (marker === 0xE0) return ascii(seg, 4, 5) === "JFIF\0";
    if (marker === 0xE2) return opts.keepColorProfile && ascii(seg, 4, 12) === "ICC_PROFILE\0";
    if (marker === 0xEE) return ascii(seg, 4, 5) === "Adobe";
    if (marker >= 0xE1 && marker <= 0xEF) return false; // EXIF, XMP, MPF, IPTC, maker data...
    if (marker === 0xFE) return false; // comment
    return true;
}

// Returns the orientation if the segment was EXIF.
function describeJpegSegment(marker: number, seg: Uint8Array, found: Found): number {
    if (marker === 0xE1) {
        if (ascii(seg, 4, 6) === "Exif\0\0") return describeExif(seg.subarray(10), found);
        add(found, ascii(seg, 4, 20).startsWith("http://ns.adobe.com/") ? "XMP" : "Vendor data");
    } else if (marker === 0xE0) add(found, "Embedded thumbnail");
    else if (marker === 0xE2) {
        const id = ascii(seg, 4, 12);
        add(found, id === "ICC_PROFILE\0" ? "Color profile" : id.startsWith("MPF") ? "Extra images (MPF)" : "Vendor data");
    } else if (marker === 0xED) add(found, "IPTC/Photoshop data");
    else if (marker === 0xFE) add(found, "Comment");
    else add(found, "Vendor data");
    return 0;
}

function stripJpeg(b: Uint8Array, opts: StripOptions, found: Found) {
    const parts: Uint8Array[] = [b.subarray(0, 2)];
    let insertAt = 1;
    let orientation = 0;
    let pos = 2;

    while (pos < b.length) {
        if (b[pos] !== 0xFF) malformed("JPEG");
        const marker = b[pos + 1];

        if (marker === 0xFF) { pos++; continue; }
        if (marker === 0xD9) {
            parts.push(b.subarray(pos, pos + 2));
            // Anything after EOI is trailer data (MPF secondary images, vendor blobs) that carries its own metadata.
            if (pos + 2 < b.length) add(found, "Trailing data after the image");
            break;
        }
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
            parts.push(b.subarray(pos, pos + 2));
            pos += 2;
            continue;
        }

        if (pos + 4 > b.length) malformed("JPEG");
        const end = pos + 2 + u16be(b, pos + 2);
        if (end > b.length || end < pos + 4) malformed("JPEG");
        const seg = b.subarray(pos, end);

        if (marker === 0xDA) {
            // Skip over entropy-coded data to the next real marker.
            let p = end;
            for (; ;) {
                p = b.indexOf(0xFF, p);
                if (p === -1 || p + 1 >= b.length) { p = b.length; break; }
                const n = b[p + 1];
                if (n === 0x00 || (n >= 0xD0 && n <= 0xD7)) p += 2;
                else if (n === 0xFF) p += 1;
                else break;
            }
            parts.push(b.subarray(pos, p));
            pos = p;
            continue;
        }

        if (keepJpegSegment(marker, seg, opts)) {
            parts.push(seg);
            if (marker === 0xE0 && parts.length === 2) insertAt = 2;
        } else {
            const o = describeJpegSegment(marker, seg, found);
            if (!orientation) orientation = o;
        }
        pos = end;
    }

    if (opts.keepOrientation && orientation > 1 && orientation <= 8)
        parts.splice(insertAt, 0, orientationApp1(orientation));

    return parts;
}

// ---------- PNG ----------

const PNG_KEEP = new Set([
    "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "sBIT", "sRGB", "cICP", "mDCV", "cLLI", "bKGD", "pHYs",
    "acTL", "fcTL", "fdAT"
]);

function stripPng(b: Uint8Array, opts: StripOptions, found: Found) {
    const parts: Uint8Array[] = [b.subarray(0, 8)];
    let pos = 8;

    while (pos + 12 <= b.length) {
        const len = u32be(b, pos);
        const end = pos + 12 + len;
        if (end > b.length) malformed("PNG");
        const type = ascii(b, pos + 4, 4);
        const data = b.subarray(pos + 8, pos + 8 + len);

        if (PNG_KEEP.has(type) || (type === "iCCP" && opts.keepColorProfile)) parts.push(b.subarray(pos, end));
        else if (type === "eXIf") describeExif(data, found);
        else if (type === "iTXt" && ascii(data, 0, 17) === "XML:com.adobe.xmp") add(found, "XMP");
        else if (type === "tEXt" || type === "zTXt" || type === "iTXt") add(found, "Text fields");
        else if (type === "tIME") add(found, "Modification time");
        else if (type === "iCCP") add(found, "Color profile");
        else add(found, `${type} chunk`);

        pos = end;
        if (type === "IEND") break;
    }
    if (pos < b.length) add(found, "Trailing data after the image");
    return parts;
}

// ---------- WebP ----------

const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

function stripWebp(b: Uint8Array, opts: StripOptions, found: Found) {
    const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
    const chunks: Uint8Array[] = [];
    if (riffEnd < b.length) add(found, "Trailing data after the image");
    let pos = 12;

    while (pos + 8 <= riffEnd) {
        const size = u32le(b, pos + 4);
        const end = pos + 8 + size + (size & 1);
        if (end > riffEnd + 1) malformed("WebP");
        const type = ascii(b, pos, 4);
        if (WEBP_KEEP.has(type) || (type === "ICCP" && opts.keepColorProfile)) {
            let chunk = b.subarray(pos, Math.min(end, riffEnd));
            if (type === "VP8X") {
                chunk = chunk.slice();
                chunk[8] &= ~(0x08 | 0x04 | (opts.keepColorProfile ? 0 : 0x20));
            }
            chunks.push(chunk);
        } else if (type === "EXIF") {
            const data = b.subarray(pos + 8, pos + 8 + size);
            describeExif(ascii(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data, found);
        } else if (type === "XMP ") add(found, "XMP");
        else if (type === "ICCP") add(found, "Color profile");
        else add(found, `${type.trim()} chunk`);
        pos = end;
    }

    const body = chunks.reduce((n, c) => n + c.length, 0);
    const header = new Uint8Array(12);
    header.set(b.subarray(0, 12));
    new DataView(header.buffer).setUint32(4, body + 4, true);
    return [header, ...chunks];
}

// ---------- GIF ----------

function stripGif(b: Uint8Array, found: Found) {
    let pos = 13;
    if (b[10] & 0x80) pos += 3 * (1 << ((b[10] & 7) + 1));
    const parts: Uint8Array[] = [b.subarray(0, pos)];

    const skipSubBlocks = (p: number) => {
        while (p < b.length && b[p] !== 0) p += b[p] + 1;
        if (p >= b.length) malformed("GIF");
        return p + 1;
    };

    while (pos < b.length) {
        const intro = b[pos];
        if (intro === 0x3B) {
            parts.push(b.subarray(pos, pos + 1));
            if (pos + 1 < b.length) add(found, "Trailing data after the image");
            break;
        }
        if (intro === 0x21) {
            const label = b[pos + 1];
            const end = skipSubBlocks(pos + 2);
            const app = label === 0xFF ? ascii(b, pos + 3, 11) : "";
            if (label === 0xF9 || label === 0x01 || /^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(app)) parts.push(b.subarray(pos, end));
            else add(found, label === 0xFE ? "Comment" : app.startsWith("XMP") ? "XMP" : "Application data");
            pos = end;
        } else if (intro === 0x2C) {
            let p = pos + 10;
            if (b[pos + 9] & 0x80) p += 3 * (1 << ((b[pos + 9] & 7) + 1));
            const end = skipSubBlocks(p + 1);
            parts.push(b.subarray(pos, end));
            pos = end;
        } else malformed("GIF");
    }
    return parts;
}

// ---------- ISO BMFF (MP4 / MOV) ----------

const NEUTRALISE = new Set(["udta", "meta", "uuid"]);
const MAX_MOOV = 64 * 1024 * 1024;

function boxHeader(b: Uint8Array, p: number, limit: number) {
    let size = u32be(b, p);
    let header = 8;
    if (size === 1) {
        size = u32be(b, p + 8) * 2 ** 32 + u32be(b, p + 12);
        header = 16;
    } else if (size === 0) size = limit - p;
    if (size < header || p + size > limit) malformed("video");
    return { size, header, type: ascii(b, p + 4, 4) };
}

function describeVideoBox(box: Uint8Array, found: Found) {
    const before = found.size;
    if (includesBytes(box, "\xA9xyz") || includesBytes(box, "com.apple.quicktime.location")) add(found, "GPS location");
    if (includesBytes(box, "\xA9mak") || includesBytes(box, "\xA9mod") || includesBytes(box, "com.apple.quicktime.model")) add(found, "Device make/model");
    if (includesBytes(box, "\xA9swr") || includesBytes(box, "com.apple.quicktime.software")) add(found, "Software");
    if (includesBytes(box, "\xA9day") || includesBytes(box, "com.apple.quicktime.creationdate")) add(found, "Recording date");
    if (includesBytes(box, "<x:xmpmeta")) add(found, "XMP");
    if (found.size === before) add(found, "Video metadata tags");
}

function toFree(b: Uint8Array, p: number, size: number, header: number, found: Found) {
    describeVideoBox(b.subarray(p + header, p + size), found);
    b.set([0x66, 0x72, 0x65, 0x65], p + 4); // "free"
    b.fill(0, p + header, p + size);
}

// Walks moov (and its trak children) in place. Returns true if anything was neutralised.
function scrubContainer(b: Uint8Array, start: number, end: number, found: Found): boolean {
    let changed = false;
    for (let p = start; p + 8 <= end;) {
        const { size, header, type } = boxHeader(b, p, end);
        if (NEUTRALISE.has(type)) {
            toFree(b, p, size, header, found);
            changed = true;
        } else if (type === "trak") {
            changed = scrubContainer(b, p + header, p + size, found) || changed;
        }
        p += size;
    }
    return changed;
}

async function stripIsoVideo(file: Blob, found: Found): Promise<BlobPart[]> {
    const parts: BlobPart[] = [];
    let last = 0;
    let pos = 0;

    while (pos + 8 <= file.size) {
        const head = new Uint8Array(await file.slice(pos, pos + 16).arrayBuffer());
        let size = u32be(head, 0);
        let header = 8;
        if (size === 1) { size = u32be(head, 8) * 2 ** 32 + u32be(head, 12); header = 16; } else if (size === 0) size = file.size - pos;
        if (size < header || pos + size > file.size) malformed("video");
        const type = ascii(head, 4, 4);

        if (type === "moov" || NEUTRALISE.has(type)) {
            if (size > MAX_MOOV) throw new Error(`Video ${type} box too large to process`);
            const box = new Uint8Array(await file.slice(pos, pos + size).arrayBuffer());
            const touched = type === "moov"
                ? scrubContainer(box, header, size, found)
                : (toFree(box, 0, size, header, found), true);
            if (touched) {
                parts.push(file.slice(last, pos), box);
                last = pos + size;
            }
        }
        pos += size;
    }

    parts.push(file.slice(last));
    return parts;
}

// ---------- Fallback re-encode ----------

// Formats we can't edit losslessly but Chromium can decode. Re-encoded to PNG (lossless pixels, no metadata).
async function reencodeToPng(file: File): Promise<File> {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return new File([blob], file.name.replace(/\.[^.]*$/, "") + ".png", { type: "image/png" });
    } finally {
        bitmap.close();
    }
}

// ---------- Entry ----------

type Kind = "jpeg" | "png" | "webp" | "gif" | "isovideo" | "reencode" | null;

const REENCODE_BRANDS = /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif|avis)$/;

async function detect(file: File): Promise<Kind> {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpeg";
    if (u32be(b, 0) === 0x89504E47 && u32be(b, 4) === 0x0D0A1A0A) return "png";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
    if (ascii(b, 0, 4) === "GIF8") return "gif";
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) || (b[0] === 0x4D && b[1] === 0x4D && b[3] === 0x2A)) return "reencode"; // TIFF
    if (b[0] === 0xFF && b[1] === 0x0A) return "reencode"; // JPEG XL codestream
    if (ascii(b, 4, 8) === "JXL \r\n\x87\n") return "reencode";

    const box = ascii(b, 4, 4);
    if (box === "ftyp") return REENCODE_BRANDS.test(ascii(b, 8, 4)) ? "reencode" : "isovideo";
    if (/^(moov|mdat|wide|free|skip)$/.test(box) && file.type.startsWith("video/")) return "isovideo";
    return null;
}

const MAX_IMAGE = 200 * 1024 * 1024;

/**
 * Removes identifying metadata. Returns the original file untouched when there is nothing to do,
 * and throws if a supported file could not be processed safely.
 */
export async function stripMetadata(file: File, opts: StripOptions): Promise<StripResult> {
    const unchanged = { file, changed: false, removed: [] };
    const kind = await detect(file);
    if (kind == null) return unchanged;

    if (kind === "reencode")
        return { file: await reencodeToPng(file), changed: true, removed: [{ name: "All metadata", value: "re-encoded to PNG" }] };

    const found: Found = new Map();
    let parts: BlobPart[];

    if (kind === "isovideo") {
        if (!opts.videos) return unchanged;
        parts = await stripIsoVideo(file, found);
    } else {
        if (file.size > MAX_IMAGE) throw new Error("Image too large to process");
        const b = new Uint8Array(await file.arrayBuffer());
        parts = (kind === "jpeg" ? stripJpeg(b, opts, found)
            : kind === "png" ? stripPng(b, opts, found)
                : kind === "webp" ? stripWebp(b, opts, found)
                    : stripGif(b, found)) as BlobPart[];
    }

    if (!found.size) return unchanged;
    return { file: new File(parts, file.name, { type: file.type }), changed: true, removed: [...found].map(([name, value]) => ({ name, value })) };
}
