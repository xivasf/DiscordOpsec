# DiscordOpsec
---my fork---
what-to-add:metadata stripping from pdf, svg, audio files and ect. add integrity checks to discord hooks. improve cross-client compatibility. add middle click & right click & and embed click on a link pop up the opsec warning and any other ways the warning doesnt get displayed. sensitive info protections, eg-api keys ips and other sensitive info. scam detections such as mr beast and nitro scams. patch protections seeps from discord updates. and idk what else imma add some later. 
-------------
A Vencord plugin that closes a few privacy and security holes in Discord.

- **Metadata stripping**: removes EXIF, GPS, XMP, comments and camera info from images before they upload. JPEG, PNG, WebP and GIF are edited losslessly (pixels untouched). HEIC/AVIF/TIFF get re-encoded to PNG. MP4/MOV location and device tags get wiped too.
- **Webcam block**: Discord can't turn your camera on. This covers video calls, camera previews and streaming your camera.
- **Risky attachments**: executables, scripts and archives get a warning under the message. With a VirusTotal key, the file's SHA-256 is looked up. Files are never uploaded anywhere.
- **Link warnings**: before a suspicious link opens, you get a prompt. It checks for lookalike domains (`dlscord`, `steamcommunlty`), `@` tricks, IP loggers, punycode, raw IPs, and public scam lists. You can still open the link.

## Setup

You need a working [Vencord dev setup](https://docs.vencord.dev/installing/). Clone this repo next to your Vencord checkout, then link it into `userplugins`:

```
git clone https://github.com/seekehr/DiscordOpsec
cd Vencord
mklink /J src\userplugins\discordOpsec ..\DiscordOpsec   # Windows
ln -s ../../../DiscordOpsec src/userplugins/discordOpsec  # Linux/macOS
pnpm build
pnpm inject
```

The included `tsconfig.json` expects the folder to sit next to `Vencord/`. If you copy the plugin into `userplugins` instead, delete that file.

Restart Discord and enable **DiscordOpsec** in Vencord's plugin settings.

For VirusTotal, get a free API key from virustotal.com and paste it into the plugin settings. The key is encrypted with your OS keychain (Electron `safeStorage`). It stays out of Vencord's settings file and cloud sync.

## Privacy

- Only attachment hashes go to VirusTotal, never the files. Links go there only if you click "Check URL on VirusTotal" in the warning.
- Hashing means the plugin downloads the attachment from Discord's CDN into memory. Nothing is written to disk.
- Blocklists download once a day. Domains are checked against them locally.
- Requests are rate limited to the free tier (4/min) and results are cached.

## Limitations

- Stripping only covers message attachments, not avatars, banners, emoji or stickers. Other file types (PDFs, Office docs, SVG, audio) go through unchanged. Filenames aren't changed either; use AnonymiseFileNames for that.
- The camera block stops Discord from ever requesting the camera. Discord desktop opens the camera through its native voice module, which this plugin can't touch directly. A Discord update could break the hooks. The plugin's settings page shows which protection layers are active, and you'll get a toast if the main one fails. If you need a guarantee, use your OS camera privacy toggle or a cover.
- "Unknown to VirusTotal" doesn't mean safe, and neither does zero detections.
- Link checks apply to normal clicks on links in messages and embeds. "Open link" from the context menu and copy-pasted links aren't checked. The heuristics can miss things and occasionally flag legit sites.
- VirusTotal and the blocklists only work in the desktop client (Discord or Vesktop). On web, you only get the local link checks.

## License

GPL-3.0-or-later
