# Webtext Chrome Extension

This Chrome extension allows users to select any DOM element on a webpage and scrape its text content, images, and video links into a Markdown file into an LLM friendly format. The md content is immediately copied into the clipboard.

## Features
- **Select DOM Elements**: Click on any element to select it.
- **Visual Feedback**: Hover over elements to see a red outline; click to confirm selection.
- **Markdown Export**: Scrape text, images, and video links into a Markdown file and copy into the clipboard for the user to be able to paste it easily anywhere.
- **Custom Alerts**: Notifies users when the extension cannot run on restricted pages (e.g., `chrome://` or `edge://`).

---

## Installation

### Step 1: Download the Extension
1. Clone or download this repository to your local machine.
2. Extract the files (if downloaded as a ZIP).

### Step 2: Load the Extension in Chrome/Edge
1. Open your browser and navigate to:
   - **Chrome**: `chrome://extensions/`
   - **Edge**: `edge://extensions/`
2. Enable **Developer Mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the folder where the extension files are located.

### Step 3: Pin the Extension
1. Once loaded, click the **Extensions** icon in the toolbar.
2. Pin the **DOM Scraper to Markdown** extension for easy access.

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

---

## Privacy

Webtext reads page content only on your device, on the tab you click, and sends nothing anywhere. See [PRIVACY.md](PRIVACY.md).

---

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Contributing
Contributions are welcome! If you find a bug or have a feature request, please open an issue or submit a pull request.

---

## Feedback

If you have any feedback, suggestions, or questions, feel free to reach out to me on [Twitter](https://twitter.com/jit_infinity) or add an issue on [GitHub](https://github.com/prasanjit101/to-md)
