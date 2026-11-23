/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByCodeLazy } from "@webpack";
import { ConfirmModal, openModal, showToast } from "@webpack/common";

import { LinkMode, Native, parseList, settings } from "./settings";

const logger = new Logger("DiscordOpsec");
const BYPASS = Symbol("DiscordOpsec.bypass");

// Discord's link click handler (the patched one; the bypass marker lets calls through).
const handleLinkClick = findByCodeLazy("trackAnnouncementMessageLinkClicked({") as (...a: any[]) => unknown;

interface Reason {
    text: string;
    danger?: boolean;
    weight: number;
}

// ---------- Domain helpers ----------

const DISCORD_DOMAINS = [
    "discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.media", "discord.gift", "discord.new",
    "discordstatus.com", "discord.dev", "discord.co", "discord.design", "discord.store", "discordmerch.com", "dis.gd"
];

const TWO_LEVEL_SUFFIXES = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.kr", "co.in", "co.za",
    "com.br", "com.ar", "com.mx", "com.tr", "com.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.pl", "com.ua", "com.ru"
]);

// Platforms where anyone can get a subdomain, so the subdomain is what identifies the site.
const FREE_HOSTS = new Set([
    "vercel.app", "pages.dev", "workers.dev", "github.io", "gitlab.io", "netlify.app", "web.app", "firebaseapp.com",
    "glitch.me", "replit.app", "repl.co", "herokuapp.com", "onrender.com", "fly.dev", "weebly.com", "wixsite.com",
    "blogspot.com", "rf.gd", "000webhostapp.com", "webflow.io", "framer.app", "framer.website", "gitbook.io",
    "ngrok-free.app", "ngrok.io", "trycloudflare.com", "surge.sh", "azurewebsites.net", "square.site", "carrd.co"
]);

const SHORTENERS = new Set([
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "v.gd", "ow.ly", "cutt.ly", "rb.gy", "shorturl.at", "tiny.cc",
    "rebrand.ly", "bl.ink", "s.id", "t.ly", "shorturl.me", "linktr.ee", "grabify.link", "iplogger.org", "iplogger.com", "2no.co"
]);

// IP loggers deserve a stronger warning than plain shorteners.
const IP_LOGGERS = new Set(["grabify.link", "iplogger.org", "iplogger.com", "2no.co", "yip.su", "iplogger.ru", "blasze.tk", "ps3cfw.com"]);

const ABUSED_TLDS = new Set([
    "tk", "ml", "ga", "cf", "gq", "top", "xyz", "icu", "buzz", "monster", "rest", "cam", "click", "link", "country", "kim",
    "work", "gdn", "lol", "sbs", "cfd", "quest", "bond", "zip", "mov", "su", "ru.com", "live", "shop", "online", "site", "fun"
]);

const RISKY_PATH = /\.(exe|msi|scr|bat|cmd|com|pif|ps1|vbs|vbe|jse?|wsf|hta|jar|apk|dmg|pkg|lnk|iso|img|vhdx?|reg|cpl|msix|appx)$/i;
const SCAM_WORDS = /(nitro|gift|airdrop|giveaway|free|claim|verify|verification|login|signin|wallet|bonus|reward|promo|support-?team)/;

interface Brand {
    name: string;
    tokens: string[];
    official: string[];
    // Whether "<token>" appearing inside a longer label is meaningful (only for distinctive names).
    substring: boolean;
    // Commonly impersonated in Discord scams.
    hot: boolean;
}

const BRANDS: Brand[] = [
    { name: "Discord", tokens: ["discord", "discordapp", "discordnitro"], official: DISCORD_DOMAINS, substring: true, hot: true },
    { name: "Steam", tokens: ["steamcommunity", "steampowered"], official: ["steamcommunity.com", "steampowered.com", "steamstatic.com", "steamgames.com", "steamdeck.com", "s.team"], substring: true, hot: true },
    { name: "Steam", tokens: ["steam"], official: ["steamcommunity.com", "steampowered.com", "steamstatic.com", "steamgames.com", "steamdeck.com", "s.team", "steam.tv"], substring: false, hot: true },
    { name: "PayPal", tokens: ["paypal"], official: ["paypal.com", "paypal.me", "paypalobjects.com"], substring: true, hot: true },
    { name: "Roblox", tokens: ["roblox"], official: ["roblox.com", "rbxcdn.com", "roblox.qq.com"], substring: true, hot: true },
    { name: "Epic Games", tokens: ["epicgames"], official: ["epicgames.com", "unrealengine.com", "fortnite.com"], substring: true, hot: true },
    { name: "MetaMask", tokens: ["metamask"], official: ["metamask.io"], substring: true, hot: true },
    { name: "Coinbase", tokens: ["coinbase"], official: ["coinbase.com"], substring: true, hot: true },
    { name: "Binance", tokens: ["binance"], official: ["binance.com", "binance.us"], substring: true, hot: true },
    { name: "OpenSea", tokens: ["opensea"], official: ["opensea.io"], substring: true, hot: true },
    { name: "Google", tokens: ["google"], official: ["google.com", "googleusercontent.com", "googleapis.com", "youtube.com", "goo.gl", "g.co", "google.dev"], substring: false, hot: false },
    { name: "Microsoft", tokens: ["microsoft", "microsoftonline"], official: ["microsoft.com", "microsoftonline.com", "live.com", "office.com", "xbox.com", "azure.com", "msn.com"], substring: true, hot: false },
    { name: "Apple", tokens: ["apple", "icloud"], official: ["apple.com", "icloud.com", "apple.news"], substring: false, hot: false },
    { name: "GitHub", tokens: ["github"], official: ["github.com", "github.io", "githubusercontent.com", "github.dev", "githubstatus.com", "githubassets.com"], substring: true, hot: false },
    { name: "Twitch", tokens: ["twitch"], official: ["twitch.tv"], substring: true, hot: false },
    { name: "Instagram", tokens: ["instagram"], official: ["instagram.com"], substring: true, hot: false },
    { name: "Facebook", tokens: ["facebook"], official: ["facebook.com", "fb.com", "fb.me", "facebook.net"], substring: true, hot: false },
    { name: "Riot Games", tokens: ["riotgames", "leagueoflegends"], official: ["riotgames.com", "leagueoflegends.com"], substring: true, hot: true },
    { name: "Battle.net", tokens: ["battlenet", "blizzard"], official: ["battle.net", "blizzard.com"], substring: true, hot: true },
    { name: "PlayStation", tokens: ["playstation"], official: ["playstation.com", "playstation.net", "sony.com"], substring: true, hot: true },
    { name: "Minecraft", tokens: ["minecraft"], official: ["minecraft.net", "mojang.com", "minecraft.wiki"], substring: false, hot: false },
    { name: "Spotify", tokens: ["spotify"], official: ["spotify.com", "spotify.link"], substring: true, hot: false },
    { name: "Netflix", tokens: ["netflix"], official: ["netflix.com"], substring: true, hot: false },
    { name: "Telegram", tokens: ["telegram"], official: ["telegram.org", "t.me", "telegram.me"], substring: false, hot: false }
];

function registrable(labels: string[]) {
    const last2 = labels.slice(-2).join(".");
    const n = TWO_LEVEL_SUFFIXES.has(last2) || FREE_HOSTS.has(last2) ? 3 : 2;
    return labels.slice(-n).join(".");
}

const isUnder = (host: string, domain: string) => host === domain || host.endsWith("." + domain);

// Maps look-alike characters onto one form, including the classic l/I/1 swap.
const unify = (s: string) => s
    .replace(/rn/g, "m").replace(/vv/g, "w").replace(/0/g, "o").replace(/[1!|i]/g, "l")
    .replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/8/g, "b");

const withoutOneChar = (s: string, i: number) => s.slice(0, i) + s.slice(i + 1);

// Only typo patterns typical for phishing: confusable letters, a doubled/extra letter, swapped neighbours,
// or a dropped letter when the whole label is the typo. Plain one-letter substitutions are ignored ("discard", "stream").
function lookalike(label: string, token: string) {
    if (token.length < 6 || label.includes(token)) return false;
    const u = unify(label);
    const t = unify(token);
    if (u.includes(t)) return true;

    for (let i = 0; i + t.length + 1 <= u.length; i++) {
        const win = u.slice(i, i + t.length + 1);
        for (let j = 0; j < win.length; j++) if (withoutOneChar(win, j) === t) return true;
    }
    for (let i = 0; i + t.length <= u.length; i++) {
        const win = u.slice(i, i + t.length);
        for (let j = 0; j < t.length - 1; j++)
            if (win[j] === t[j + 1] && win[j + 1] === t[j] && win.slice(0, j) === t.slice(0, j) && win.slice(j + 2) === t.slice(j + 2)) return true;
    }
    if (u.length === t.length - 1)
        for (let j = 0; j < t.length; j++) if (withoutOneChar(t, j) === u) return true;
    return false;
}

function brandReasons(host: string, labels: string[]): Reason[] {
    const reg = registrable(labels);
    const words = labels.slice(0, -1).flatMap(l => [l, ...l.split("-"), l.replace(/-/g, "")]);

    for (const brand of BRANDS) {
        if (brand.official.some(d => isUnder(host, d))) continue;
        for (const token of brand.tokens) {
            if (brand.substring && words.some(w => lookalike(w, token)))
                return [{ text: `${reg} looks like an imitation of ${brand.name}`, danger: true, weight: 3 }];

            if (words.some(w => w === token || (brand.substring && w.includes(token)))) {
                const scammy = SCAM_WORDS.test(host);
                return [{
                    text: `Uses the name "${brand.name}" but ${reg} is not an official ${brand.name} domain`,
                    danger: brand.hot && scammy,
                    weight: brand.hot ? 2 : 1
                }];
            }
        }
    }
    return [];
}

export function analyzeUrl(url: URL): Reason[] {
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const labels = host.split(".");
    const reasons: Reason[] = [];

    if (url.username || url.password)
        reasons.push({ text: `The text before "@" is a disguise. This link really goes to ${host}`, danger: true, weight: 3 });

    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("["))
        reasons.push({ text: "Points to a raw IP address instead of a domain", weight: 2 });
    else {
        reasons.push(...brandReasons(host, labels));

        if (labels.some(l => l.startsWith("xn--")))
            reasons.push({ text: "Uses an internationalized (punycode) domain, which can imitate other sites with look-alike letters", weight: 2 });

        const reg = registrable(labels);
        const base = labels.slice(-2).join(".");
        if (IP_LOGGERS.has(reg) || IP_LOGGERS.has(base))
            reasons.push({ text: "Known IP-logging service: opening it reveals your IP address", danger: true, weight: 3 });
        else if (SHORTENERS.has(reg) || SHORTENERS.has(base))
            reasons.push({ text: "Link shortener: the real destination is hidden", weight: 1 });

        if (FREE_HOSTS.has(base)) reasons.push({ text: `Hosted on ${base}, where anyone can create a site`, weight: 1 });

        const tld = labels[labels.length - 1];
        if (ABUSED_TLDS.has(tld)) reasons.push({ text: `.${tld} domains are frequently used for scams`, weight: 1 });

        const official = BRANDS.some(b => b.official.some(d => isUnder(host, d)));
        if (labels.length >= 5 || host.length > 60) reasons.push({ text: "Unusually long or deeply nested domain", weight: 1 });
        if (!official && SCAM_WORDS.test(host)) reasons.push({ text: "Domain contains words common in scams (gift, nitro, login, free...)", weight: 1 });
    }

    if (url.protocol === "http:") reasons.push({ text: "Not encrypted (http)", weight: 1 });
    if (url.port && url.port !== "80" && url.port !== "443") reasons.push({ text: `Uses an unusual port (${url.port})`, weight: 1 });
    if (RISKY_PATH.test(url.pathname)) reasons.push({ text: "Downloads a file type that can run code", weight: 2 });

    return reasons;
}

const isFlagged = (reasons: Reason[]) => reasons.some(r => r.danger) || reasons.reduce((n, r) => n + r.weight, 0) >= 2;

// ---------- Blocklists ----------

export function enabledLists() {
    const lists: ("antiscam" | "phishingArmy")[] = [];
    if (settings.store.blocklistAntiScam) lists.push("antiscam");
    if (settings.store.blocklistPhishingArmy) lists.push("phishingArmy");
    return lists;
}

export function prepareBlocklists() {
    if (!Native || !settings.store.linkWarnings) return;
    Native.prepareBlocklists(enabledLists()).catch(e => logger.warn("Blocklist update failed", e));
}

async function blocklistReason(host: string): Promise<Reason | null> {
    const lists = enabledLists();
    if (!Native || !lists.length) return null;
    const timeout = new Promise<null>(r => setTimeout(() => r(null), 2500));
    const hit = await Promise.race([Native.checkDomain(host, lists).catch(() => null), timeout]);
    return hit ? { text: `Listed as a scam/phishing domain by ${hit}`, danger: true, weight: 3 } : null;
}

// ---------- Warning dialog ----------

function WarningBody({ url, reasons, onVirusTotal }: { url: URL; reasons: Reason[]; onVirusTotal?: () => void; }) {
    const href = url.href.length > 300 ? url.href.slice(0, 300) + "…" : url.href;
    return (
        <div className="vc-opsec-link">
            <div className="vc-opsec-url">{href}</div>
            <div>Domain: <strong>{url.hostname}</strong></div>
            {reasons.length
                ? <ul>{reasons.map(r => <li key={r.text} className={r.danger ? "vc-opsec-reason-danger" : undefined}>{r.text}</li>)}</ul>
                : <p>No warning signs found.</p>}
            {onVirusTotal && (
                <div>
                    <button className="vc-opsec-btn" onClick={onVirusTotal}>Check URL on VirusTotal</button>
                    <span className="vc-opsec-note"> sends this URL to VirusTotal</span>
                </div>
            )}
            <p className="vc-opsec-note">
                These are local checks and public blocklists. A link without warnings can still be harmful, and a flagged one can be a false positive.
            </p>
        </div>
    );
}

function showWarning(url: URL, reasons: Reason[], proceed: () => void) {
    const danger = reasons.some(r => r.danger);
    const title = danger ? "Dangerous link" : reasons.length ? "Suspicious link" : "Leaving Discord";

    try {
        openModal(modalProps => (
            <ConfirmModal
                {...modalProps}
                title={title}
                confirmText="Open anyway"
                cancelText="Go back"
                variant="critical"
                onConfirm={proceed}
            >
                <WarningBody
                    url={url}
                    reasons={reasons}
                    onVirusTotal={Native ? () => { modalProps.onClose(); checkOnVirusTotal(url, reasons, proceed); } : undefined}
                />
            </ConfirmModal>
        ));
    } catch (e) {
        // Never swallow the click silently: fall back to the browser's own prompt.
        logger.error("Failed to open link warning, falling back to confirm()", e);
        const text = `${title}\n\n${url.href}\n\n${reasons.map(r => "- " + r.text).join("\n") || "No warning signs found."}\n\nOpen anyway?`;
        if (window.confirm(text)) proceed();
    }
}

async function checkOnVirusTotal(url: URL, reasons: Reason[], proceed: () => void) {
    if (!await Native!.hasApiKey()) {
        showToast({ text: "Add a VirusTotal API key in DiscordOpsec settings first", variant: "critical" });
        return showWarning(url, reasons, proceed);
    }

    showToast({ text: "Checking on VirusTotal…", variant: "default" });
    const res = await Native!.lookupUrl(url.href, settings.store.vtRequestsPerMinute)
        .catch(e => ({ kind: "error" as const, message: String(e), retryable: true }));

    let summary: Reason;
    if (res.kind === "found") {
        const { malicious, suspicious, harmless, undetected } = res.stats;
        const total = malicious + suspicious + harmless + undetected;
        summary = malicious + suspicious > 0
            ? { text: `VirusTotal: ${malicious} malicious and ${suspicious} suspicious verdicts out of ${total}`, danger: true, weight: 3 }
            : { text: `VirusTotal: no engine flags this URL (0/${total})`, weight: 0 };
    } else if (res.kind === "unknown") {
        summary = { text: "VirusTotal has no record of this exact URL", weight: 0 };
    } else {
        summary = { text: `VirusTotal check failed: ${res.message}`, weight: 0 };
    }

    showWarning(url, [summary, ...reasons.filter(r => !r.text.startsWith("VirusTotal"))], proceed);
}

// ---------- Click hook ----------

/**
 * Called at the top of Discord's link click handler. Returns true when the click was taken over.
 * To continue, the handler is re-invoked with a bypass marker and no event.
 */
export function onLinkClick(args: IArguments): boolean {
    try {
        const [props, event] = args;
        if (!settings.store.linkWarnings || !props || props[BYPASS] || typeof props.href !== "string") return false;

        let url: URL;
        try {
            url = new URL(props.href);
        } catch {
            return false;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;

        const host = url.hostname.toLowerCase();
        if (DISCORD_DOMAINS.some(d => isUnder(host, d))) return false;
        if (parseList(settings.store.trustedDomains).some(d => isUnder(host, d))) return false;

        const rest = Array.prototype.slice.call(args, 2);
        // Re-run Discord's handler, which still applies its own checks (blocked domains, "Leaving Discord" prompt).
        const continueNormally = () => handleLinkClick({ ...props, [BYPASS]: true }, null, ...rest);
        // The user already accepted our warning, so skip Discord's extra prompt.
        const openDirectly = () => handleLinkClick({ ...props, onClick: undefined, trusted: true, shouldConfirm: false, [BYPASS]: true }, null, ...rest);

        const reasons = analyzeUrl(url);
        const alwaysWarn = settings.store.linkMode === LinkMode.AllExternal;
        // Custom onClick handlers may not tolerate a null event, so those links only get the synchronous checks.
        const canDefer = Native != null && enabledLists().length > 0 && typeof props.onClick !== "function";

        if (!canDefer) {
            if (!alwaysWarn && !isFlagged(reasons)) return false;
            event?.preventDefault?.();
            showWarning(url, reasons, openDirectly);
            return true;
        }

        event?.preventDefault?.();
        blocklistReason(host).then(hit => {
            const all = hit ? [hit, ...reasons] : reasons;
            if (alwaysWarn || isFlagged(all)) showWarning(url, all, openDirectly);
            else continueNormally();
        }, () => continueNormally());
        return true;
    } catch (e) {
        logger.error("Link check failed", e);
        return false;
    }
}
