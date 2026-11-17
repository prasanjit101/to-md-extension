# TODO — Chrome Web Store launch

Code prep is done (`manifest.json`, `background.js`, `content.js`, `PRIVACY.md`, `build.sh`,
`store-assets/`). These are the steps that need your accounts.

## 1. Host the privacy policy

- [ ] Publish `PRIVACY.md` at a public URL (the Privacy tab requires a live link).
      Suggested: GitHub Pages on `prasanjit101/to-md` →
      `https://prasanjit101.github.io/to-md/PRIVACY.md`
- [ ] Confirm the URL loads in a logged-out browser window.

## 2. Developer account

- [ ] Register at https://chrome.google.com/webstore/devconsole — one-time **$5** fee.
- [ ] Verify the account email and enable 2-step verification.
- [ ] Optional: verify domain ownership in Search Console for a "verified publisher" badge.

## 3. Build and upload

- [ ] Run `./build.sh` → produces `dist/webtext-<version>.zip` (manifest at zip root).
- [ ] **Add new item** in the dashboard → upload the zip.
- [ ] Note the pre-submission installation test result before submitting.

## 4. Store listing

- [ ] Store icon: `icons/icon128.png`
- [ ] Screenshots: `store-assets/screenshot-1-hover.png`,
      `screenshot-2-selected.png`, `screenshot-3-copied.png` (all 1280×800)
- [ ] Category: Developer Tools. Language: English.
- [ ] Detailed description — start with the one-liner, then features.
- [ ] Optional: 440×280 small promo tile, 1400×560 marquee tile, YouTube demo.
- [ ] Homepage / Support URL: `https://github.com/prasanjit101/to-md`

## 5. Privacy tab (copy-paste)

**Single purpose description**

> Webtext converts a part of a webpage that the user explicitly selects into clean
> Markdown and copies it to the clipboard.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `activeTab` | The extension only acts after the user clicks its toolbar icon; `activeTab` grants access to that one tab for that one action. |
| `scripting` | Injects the element picker into the tab the user just clicked. |
| `clipboardWrite` | Copies the generated Markdown to the clipboard. |

- [ ] **Remote code:** "No, I am not using remote code."
- [ ] **Data usage:** check **Website content** only — processed on-device, never
      transmitted, stored, or sold. Certify the limited-use statements.

## 6. Test instructions tab

- [ ] Paste: "Click the Webtext toolbar icon, hover an element to see the red outline,
      click one or more elements, then press Enter to copy the Markdown. Esc cancels."

## 7. Submit

- [ ] **Submit for Review** (use *Defer publish* if you want to control launch timing —
      staged submissions expire after 30 days).
- [ ] Enable "staged and reviewed" email notifications on the Account page.

## Notes

- A new publisher account has a limit of **2** published extensions (not 3). A slot is
  consumed when you *submit*, not when it's approved. Request an increase from the
  dashboard once you hit it.
- Bump `"version"` in `manifest.json` for every subsequent upload; it must strictly
  increase.
