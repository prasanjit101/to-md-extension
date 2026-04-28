# Webtext Chrome Extension

This Chrome extension allows users to select any DOM element on a webpage and scrape its text content, images, and video links into a Markdown file into an LLM friendly format. The md content is immediately copied into the clipboard.

## Features
- **Select DOM Elements**: Click on any element to select it.
- **Visual Feedback**: Hover over elements to see a red outline; click to confirm selection.
- **Markdown Export**: Scrape text, images, and video links into a Markdown file and copy into the clipboard for the user to be able to paste it easily anywhere.
- **Custom Alerts**: Notifies users when the extension cannot run on restricted pages (e.g., `chrome://` or `edge://`).

---

## Example

### Input: Webpage Content
```html
<div>
  <h1>Welcome to My Website</h1>
  <p>This is a <strong>sample</strong> paragraph with a <a href="https://example.com">link</a>.</p>
  <img src="image.png" alt="Sample Image">
</div>
```

### Output: Downloaded Markdown File (`Welcome_to_My_Website.md`)
```markdown
# Welcome to My Website

This is a **sample** paragraph with a [link](https://example.com).

![Sample Image](image.png)
```
