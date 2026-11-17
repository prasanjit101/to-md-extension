// Chrome refuses to inject content scripts into restricted pages, so the
// background service worker already blocks those clicks. This guard is a
// defensive no-op that also keeps the rest of the file inside a single block
// without re-indenting ~1100 lines.
const RESTRICTED_PROTOCOLS = [
  "chrome:",
  "chrome-untrusted:",
  "chrome-extension:",
  "edge:",
  "about:",
  "devtools:",
  "view-source:",
  "file:"
];

function isRestrictedPage() {
  return RESTRICTED_PROTOCOLS.indexOf(window.location.protocol) !== -1;
}

if (!isRestrictedPage()) {
  let hoveredElement = null;
  let isExtensionActive = true;

  // Multi-select state. selectedElements preserves click order; each entry
  // stores the element's prior inline outline so it can be restored on cleanup.
  const selectedElements = [];
  let badgeElement = null;

  const HOVER_OUTLINE = "2px solid red";
  const SELECTED_OUTLINE = "2px solid #2563ff";

  // background.js re-injects this script on every toolbar click. Tear down any
  // still-active session from a previous injection so we don't run two sets of
  // listeners with orphaned outlines/state at once.
  if (typeof window.__webtextCleanup === "function") {
    window.__webtextCleanup();
  }

  /**
   * Convert a relative URL to an absolute URL
   */
  function toAbsoluteUrl(url) {
    if (!url) return "";
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  /**
   * Check if an element is visible (not hidden via CSS)
   */
  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;

    const style = window.getComputedStyle(element);

    // Check for common hiding methods
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.opacity === "0") return false;

    // Check for zero dimensions (but allow inline elements)
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && style.overflow === "hidden")
      return false;

    // Check for hidden attribute
    if (element.hidden) return false;

    // Check aria-hidden
    if (element.getAttribute("aria-hidden") === "true") return false;

    return true;
  }

  /**
   * Check if an element should be ignored during conversion
   */
  function shouldIgnoreElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = node.tagName.toLowerCase();

    // Ignored tags that don't contribute meaningful content
    const ignoredTags = [
      "script",
      "style",
      "noscript",
      "template",
      "svg",
      "canvas",
      "head",
      "meta",
      "link",
      "input",
      "button",
      "select",
      "textarea",
      "form",
    ];

    if (ignoredTags.includes(tagName)) return true;

    // Ignore common ad/utility classes. Match whole tokens, not substrings —
    // otherwise classes like "header", "shadow", "padding", "loading" all get
    // dropped because they contain the substring "ad".
    const ignoredClassTokens = new Set([
      "ad",
      "ads",
      "advert",
      "adverts",
      "advertisement",
      "advertising",
      "banner",
      "popup",
      "modal",
      "overlay",
      "cookie",
      "cookies",
      "newsletter",
      "subscribe",
      "social-share",
      "share-buttons",
    ]);

    if (node.classList && node.classList.length > 0) {
      for (const cls of node.classList) {
        const lower = cls.toLowerCase();
        if (ignoredClassTokens.has(lower)) return true;
        // Split compound class names (e.g. "ad-banner", "cookie_notice") into
        // tokens and check each token. A class only counts as "ignored" if it
        // is the ignore token alone or paired with other ignore tokens.
        const tokens = lower.split(/[-_]+/).filter(Boolean);
        if (
          tokens.length > 1 &&
          tokens.every((t) => ignoredClassTokens.has(t))
        ) {
          return true;
        }
      }
    }

    // Check visibility
    if (!isElementVisible(node)) return true;

    return false;
  }

  /**
   * Get the best image source from img, picture, or source elements
   */
  function getBestImageSrc(imgElement) {
    // Check for srcset and get the largest image
    if (imgElement.srcset) {
      const srcsetParts = imgElement.srcset.split(",").map((s) => s.trim());
      let bestSrc = null;
      let bestWidth = 0;

      for (const part of srcsetParts) {
        const [url, descriptor] = part.split(/\s+/);
        const width = descriptor ? parseInt(descriptor) : 0;
        if (width > bestWidth || !bestSrc) {
          bestWidth = width;
          bestSrc = url;
        }
      }

      if (bestSrc) return toAbsoluteUrl(bestSrc);
    }

    // Check parent picture element for source
    const picture = imgElement.closest("picture");
    if (picture) {
      const sources = picture.querySelectorAll("source");
      for (const source of sources) {
        if (source.srcset) {
          const srcsetParts = source.srcset.split(",")[0].split(/\s+/)[0];
          return toAbsoluteUrl(srcsetParts);
        }
      }
    }

    // Fallback to src or data-src (lazy loading)
    return toAbsoluteUrl(
      imgElement.src ||
        imgElement.dataset.src ||
        imgElement.dataset.lazySrc ||
        imgElement.getAttribute("data-original") ||
        "",
    );
  }

  /**
   * Get video source URL
   */
  function getVideoSrc(videoElement) {
    if (videoElement.src) {
      return toAbsoluteUrl(videoElement.src);
    }

    const source = videoElement.querySelector("source");
    if (source && source.src) {
      return toAbsoluteUrl(source.src);
    }

    return toAbsoluteUrl(
      videoElement.dataset.src || videoElement.dataset.videoSrc || "",
    );
  }

  /**
   * Get audio source URL
   */
  function getAudioSrc(audioElement) {
    if (audioElement.src) {
      return toAbsoluteUrl(audioElement.src);
    }

    const source = audioElement.querySelector("source");
    if (source && source.src) {
      return toAbsoluteUrl(source.src);
    }

    return "";
  }

  /**
   * Extract embed URL from iframe (YouTube, Vimeo, etc.)
   */
  function getIframeInfo(iframeElement) {
    const src = iframeElement.src || iframeElement.dataset.src || "";
    if (!src) return null;

    const absoluteSrc = toAbsoluteUrl(src);
    const title = iframeElement.title || "Embedded content";

    let type = "embed";
    if (
      absoluteSrc.includes("youtube.com") ||
      absoluteSrc.includes("youtu.be")
    ) {
      type = "YouTube video";
    } else if (absoluteSrc.includes("vimeo.com")) {
      type = "Vimeo video";
    } else if (
      absoluteSrc.includes("twitter.com") ||
      absoluteSrc.includes("x.com")
    ) {
      type = "Twitter embed";
    } else if (absoluteSrc.includes("spotify.com")) {
      type = "Spotify embed";
    }

    return { src: absoluteSrc, title, type };
  }

  /**
   * Calculate list depth for proper indentation
   */
  function getListDepth(element) {
    let depth = 0;
    let parent = element.parentElement;

    while (parent) {
      const tagName = parent.tagName.toLowerCase();
      if (tagName === "ul" || tagName === "ol") {
        depth++;
      }
      parent = parent.parentElement;
    }

    return depth;
  }

  /**
   * Get the list item index for ordered lists
   */
  function getListItemIndex(liElement) {
    const parent = liElement.parentElement;
    if (!parent || parent.tagName.toLowerCase() !== "ol") return null;

    let index = 1;
    const start = parseInt(parent.getAttribute("start")) || 1;

    let sibling = liElement.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === "li") {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    return start + index - 1;
  }

  /**
   * Convert table to markdown
   */
  function convertTableToMarkdown(tableElement) {
    const rows = [];
    const thead = tableElement.querySelector("thead");
    const tbody = tableElement.querySelector("tbody") || tableElement;

    let headerRow = null;
    if (thead) {
      const headerCells = thead.querySelectorAll("th, td");
      if (headerCells.length > 0) {
        headerRow = Array.from(headerCells).map((cell) =>
          convertToMarkdown(cell, { inline: true })
            .trim()
            .replace(/\|/g, "\\|"),
        );
      }
    }

    const bodyRows = tbody.querySelectorAll("tr");
    for (const row of bodyRows) {
      if (row.closest("thead")) continue;

      const cells = row.querySelectorAll("th, td");
      if (cells.length > 0) {
        const rowData = Array.from(cells).map((cell) =>
          convertToMarkdown(cell, { inline: true })
            .trim()
            .replace(/\|/g, "\\|"),
        );

        if (!headerRow && row.querySelector("th")) {
          headerRow = rowData;
        } else {
          rows.push(rowData);
        }
      }
    }

    if (rows.length === 0 && !headerRow) return "";

    let markdown = "";
    const columnCount = Math.max(
      headerRow ? headerRow.length : 0,
      ...rows.map((r) => r.length),
    );

    if (headerRow) {
      markdown += "| " + headerRow.join(" | ") + " |\n";
      markdown += "| " + Array(columnCount).fill("---").join(" | ") + " |\n";
    } else if (rows.length > 0) {
      const firstRow = rows.shift();
      markdown += "| " + firstRow.join(" | ") + " |\n";
      markdown += "| " + Array(columnCount).fill("---").join(" | ") + " |\n";
    }

    for (const row of rows) {
      while (row.length < columnCount) {
        row.push("");
      }
      markdown += "| " + row.join(" | ") + " |\n";
    }

    return markdown + "\n";
  }

  /**
   * Normalize whitespace in text
   */
  function normalizeWhitespace(text) {
    return text
      .replace(/[\t\n\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Get markdown for all children of an element
   */
  function getChildrenMarkdown(element, options) {
    options = options || {};
    let result = "";

    for (const child of element.childNodes) {
      result += convertToMarkdown(child, options);
    }

    if (options.inline) {
      return normalizeWhitespace(result);
    }

    return result;
  }

  /**
   * Main conversion function
   */
  function convertToMarkdown(node, options) {
    options = options || {};
    const inline = options.inline || false;

    // Handle text nodes
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (inline) {
        return normalizeWhitespace(text);
      }
      return text.replace(/[\t\n\r]+/g, " ").replace(/\s+/g, " ");
    }

    // Skip non-element nodes
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    // Check if element should be ignored
    if (shouldIgnoreElement(node)) {
      return "";
    }

    const tagName = node.tagName.toLowerCase();

    // Headings
    if (tagName === "h1") {
      return "# " + getChildrenMarkdown(node, { inline: true }) + "\n\n";
    }
    if (tagName === "h2") {
      return "## " + getChildrenMarkdown(node, { inline: true }) + "\n\n";
    }
    if (tagName === "h3") {
      return "### " + getChildrenMarkdown(node, { inline: true }) + "\n\n";
    }
    if (tagName === "h4") {
      return "#### " + getChildrenMarkdown(node, { inline: true }) + "\n\n";
    }
    if (tagName === "h5") {
      return "##### " + getChildrenMarkdown(node, { inline: true }) + "\n\n";
    }
    if (tagName === "h6") {
      return "###### " + getChildrenMarkdown(node, { inline: true }) + "\n\n";
    }

    // Paragraphs
    if (tagName === "p") {
      const pContent = getChildrenMarkdown(node, { inline: true });
      return pContent ? pContent + "\n\n" : "";
    }

    // Divs and sections
    if (
      tagName === "div" ||
      tagName === "section" ||
      tagName === "article" ||
      tagName === "main"
    ) {
      const divContent = getChildrenMarkdown(node);
      return divContent ? divContent + "\n" : "";
    }

    // Bold
    if (tagName === "b" || tagName === "strong") {
      const boldContent = getChildrenMarkdown(node, { inline: true });
      return boldContent ? "**" + boldContent + "**" : "";
    }

    // Italic
    if (tagName === "i" || tagName === "em") {
      const italicContent = getChildrenMarkdown(node, { inline: true });
      return italicContent ? "*" + italicContent + "*" : "";
    }

    // Underline
    if (tagName === "u") {
      const underlineContent = getChildrenMarkdown(node, { inline: true });
      return underlineContent ? "<u>" + underlineContent + "</u>" : "";
    }

    // Strikethrough
    if (tagName === "s" || tagName === "strike" || tagName === "del") {
      const strikeContent = getChildrenMarkdown(node, { inline: true });
      return strikeContent ? "~~" + strikeContent + "~~" : "";
    }

    // Mark/highlight
    if (tagName === "mark") {
      const markContent = getChildrenMarkdown(node, { inline: true });
      return markContent ? "==" + markContent + "==" : "";
    }

    // Superscript
    if (tagName === "sup") {
      const supContent = getChildrenMarkdown(node, { inline: true });
      return supContent ? "<sup>" + supContent + "</sup>" : "";
    }

    // Subscript
    if (tagName === "sub") {
      const subContent = getChildrenMarkdown(node, { inline: true });
      return subContent ? "<sub>" + subContent + "</sub>" : "";
    }

    // Links
    if (tagName === "a") {
      const linkText = getChildrenMarkdown(node, { inline: true });
      const href = toAbsoluteUrl(node.href);
      if (!linkText && !href) return "";
      if (!href) return linkText;
      return "[" + (linkText || href) + "](" + href + ")";
    }

    // Images
    if (tagName === "img") {
      const imgSrc = getBestImageSrc(node);
      if (!imgSrc) return "";
      const alt = node.alt || node.title || "image";
      return "![" + alt + "](" + imgSrc + ")";
    }

    // Picture element
    if (tagName === "picture") {
      const img = node.querySelector("img");
      if (img) return convertToMarkdown(img, options);
      return "";
    }

    // Figure: image+caption when present, otherwise render children (covers
    // <figure> wrappers around <pre> code blocks emitted by rehype-pretty-code,
    // MDX, Astro Starlight, etc.).
    if (tagName === "figure") {
      const figImg = node.querySelector("img, picture");
      const figCaption = node.querySelector("figcaption");

      if (figImg) {
        const figContent = [convertToMarkdown(figImg, options)];
        if (figCaption) {
          const captionText = getChildrenMarkdown(figCaption, { inline: true });
          if (captionText) figContent.push("*" + captionText + "*");
        }
        return figContent.join("\n") + "\n\n";
      }

      const figChildren = getChildrenMarkdown(node);
      return figChildren ? figChildren + "\n" : "";
    }

    // Video
    if (tagName === "video") {
      const videoSrc = getVideoSrc(node);
      if (!videoSrc) return "";
      const videoTitle =
        node.title || node.getAttribute("aria-label") || "Video";
      return "[" + videoTitle + "](" + videoSrc + ")\n\n";
    }

    // Audio
    if (tagName === "audio") {
      const audioSrc = getAudioSrc(node);
      if (!audioSrc) return "";
      const audioTitle =
        node.title || node.getAttribute("aria-label") || "Audio";
      return "[" + audioTitle + "](" + audioSrc + ")\n\n";
    }

    // Iframe embeds
    if (tagName === "iframe") {
      const iframeInfo = getIframeInfo(node);
      if (!iframeInfo) return "";
      return (
        "[" +
        iframeInfo.type +
        ": " +
        iframeInfo.title +
        "](" +
        iframeInfo.src +
        ")\n\n"
      );
    }

    // Lists
    if (tagName === "ul" || tagName === "ol") {
      const listContent = getChildrenMarkdown(node, {
        listDepth: getListDepth(node),
      });
      return listContent ? listContent + "\n" : "";
    }

    // List items
    if (tagName === "li") {
      const depth = getListDepth(node.parentElement);
      const indent = "  ".repeat(Math.max(0, depth - 1));
      const parent = node.parentElement;
      const isOrdered = parent && parent.tagName.toLowerCase() === "ol";

      let prefix;
      if (isOrdered) {
        const index = getListItemIndex(node);
        prefix = index + ". ";
      } else {
        prefix = "- ";
      }

      let liContent = "";
      let nestedList = "";

      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = child.tagName.toLowerCase();
          if (childTag === "ul" || childTag === "ol") {
            nestedList += convertToMarkdown(child, { listDepth: depth });
          } else {
            liContent += convertToMarkdown(child, { inline: true });
          }
        } else {
          liContent += convertToMarkdown(child, { inline: true });
        }
      }

      liContent = normalizeWhitespace(liContent);
      let result = indent + prefix + liContent + "\n";
      if (nestedList) {
        result += nestedList;
      }

      return result;
    }

    // Definition lists
    if (tagName === "dl") {
      return getChildrenMarkdown(node) + "\n";
    }

    if (tagName === "dt") {
      const dtContent = getChildrenMarkdown(node, { inline: true });
      return dtContent ? "**" + dtContent + "**\n" : "";
    }

    if (tagName === "dd") {
      const ddContent = getChildrenMarkdown(node, { inline: true });
      return ddContent ? ": " + ddContent + "\n\n" : "";
    }

    // Blockquote
    if (tagName === "blockquote") {
      const quoteContent = getChildrenMarkdown(node);
      if (!quoteContent) return "";
      const quotedLines = quoteContent
        .trim()
        .split("\n")
        .map(function (line) {
          return "> " + line;
        })
        .join("\n");
      return quotedLines + "\n\n";
    }

    // Inline code
    if (tagName === "code") {
      const codeContent = node.textContent;
      // If a <code> inside a <pre> is reached directly (e.g. user clicked the
      // <code>), render the enclosing <pre> as a fenced code block instead of
      // returning raw text. The <pre> handler extracts via textContent so this
      // won't recurse back through here.
      const preParent = node.closest("pre");
      if (preParent) {
        return convertToMarkdown(preParent, options);
      }
      const backtickMatch = codeContent.match(/`+/g);
      const backtickCount = backtickMatch
        ? backtickMatch.reduce(function (max, match) {
            return Math.max(max, match.length);
          }, 0)
        : 0;
      const backticks = "`".repeat(backtickCount + 1);
      const padding = backtickCount > 0 ? " " : "";
      return backticks + padding + codeContent + padding + backticks;
    }

    // Code blocks
    if (tagName === "pre") {
      const preCode = node.querySelector("code");
      // innerText respects visual line breaks (e.g. Shiki / rehype-pretty-code
      // wrap each line in <span class="line"> with no newline characters);
      // textContent would return the whole block on one line. Fall back to
      // textContent if innerText is unavailable.
      const source = preCode || node;
      const preContent =
        typeof source.innerText === "string" && source.innerText.length > 0
          ? source.innerText
          : source.textContent;

      let language = "";
      const codeElement = preCode || node;
      const classList = Array.from(codeElement.classList);
      for (let i = 0; i < classList.length; i++) {
        const cls = classList[i];
        if (cls.startsWith("language-") || cls.startsWith("lang-")) {
          language = cls.replace(/^(language-|lang-)/, "");
          break;
        }
        if (
          cls.match(
            /^(javascript|python|java|ruby|go|rust|typescript|html|css|json|xml|bash|shell|sql)$/i,
          )
        ) {
          language = cls.toLowerCase();
          break;
        }
      }

      return "```" + language + "\n" + preContent + "\n```\n\n";
    }

    // Keyboard input
    if (tagName === "kbd") {
      const kbdContent = node.textContent;
      return "<kbd>" + kbdContent + "</kbd>";
    }

    // Tables
    if (tagName === "table") {
      return convertTableToMarkdown(node);
    }

    // Skip table internal elements
    if (
      tagName === "thead" ||
      tagName === "tbody" ||
      tagName === "tfoot" ||
      tagName === "tr" ||
      tagName === "th" ||
      tagName === "td"
    ) {
      if (inline) {
        return getChildrenMarkdown(node, { inline: true });
      }
      return "";
    }

    // Horizontal rule
    if (tagName === "hr") {
      return "---\n\n";
    }

    // Line break
    if (tagName === "br") {
      return inline ? " " : "\n";
    }

    // Abbreviations
    if (tagName === "abbr") {
      const abbrContent = getChildrenMarkdown(node, { inline: true });
      const title = node.title;
      if (title) {
        return abbrContent + " (" + title + ")";
      }
      return abbrContent;
    }

    // Time
    if (tagName === "time") {
      const timeContent = getChildrenMarkdown(node, { inline: true });
      const datetime = node.getAttribute("datetime");
      if (datetime && datetime !== timeContent) {
        return timeContent + " (" + datetime + ")";
      }
      return timeContent;
    }

    // Details/Summary (collapsible)
    if (tagName === "details") {
      const summary = node.querySelector("summary");
      const summaryText = summary
        ? getChildrenMarkdown(summary, { inline: true })
        : "Details";

      let detailsContent = "";
      for (const child of node.childNodes) {
        if (
          child.nodeType === Node.ELEMENT_NODE &&
          child.tagName.toLowerCase() === "summary"
        ) {
          continue;
        }
        detailsContent += convertToMarkdown(child, options);
      }

      return (
        "<details>\n<summary>" +
        summaryText +
        "</summary>\n\n" +
        detailsContent.trim() +
        "\n</details>\n\n"
      );
    }

    // Summary (handled by details)
    if (tagName === "summary") {
      return "";
    }

    // Span and other inline elements
    if (tagName === "span" || tagName === "label") {
      return getChildrenMarkdown(node, { inline: true });
    }

    // Default: just get children content
    return getChildrenMarkdown(node, options);
  }

  /**
   * Clean up the final markdown output
   */
  function cleanupMarkdown(markdown) {
    return markdown
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map(function (line) {
        return line.trimEnd();
      })
      .join("\n")
      .trim();
  }

  /**
   * Main function to scrape element to markdown
   */
  function scrapeToMarkdown(element) {
    const markdown = convertToMarkdown(element);
    return cleanupMarkdown(markdown);
  }

  /**
   * Show a short, non-blocking toast in the corner of the page.
   */
  function showToast(message, isError) {
    const notification = document.createElement("div");
    notification.textContent = message;
    notification.style.cssText =
      "position: fixed;" +
      "bottom: 20px;" +
      "right: 20px;" +
      "background: " +
      (isError ? "#d93025" : "black") +
      ";" +
      "color: white;" +
      "padding: 16px 24px;" +
      "border-radius: 8px;" +
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
      "font-size: 14px;" +
      "box-shadow: 0 4px 12px rgba(0,0,0,0.3);" +
      "z-index: 999999;" +
      "transition: opacity 0.3s, transform 0.3s;" +
      "opacity: 1;" +
      "transform: translateX(0);";

    document.body.appendChild(notification);

    setTimeout(function () {
      notification.style.opacity = "0";
      notification.style.transform = "translateX(100%)";
      setTimeout(function () {
        notification.remove();
      }, 300);
    }, 2000);
  }

  /**
   * Return the index of an element in the selection, or -1 if not selected.
   */
  function isSelected(el) {
    for (let i = 0; i < selectedElements.length; i++) {
      if (selectedElements[i].el === el) return i;
    }
    return -1;
  }

  /**
   * Add an element to the selection and apply the persistent selected outline.
   */
  function addSelection(el) {
    selectedElements.push({ el: el });
    el.style.outline = SELECTED_OUTLINE;
  }

  /**
   * Remove an element from the selection by index and clear its outline.
   * Outlines are always cleared to "" (matching the single-select behavior)
   * rather than restored, since the hover handler overwrites any prior inline
   * outline before an element can be selected.
   */
  function removeSelectionAt(index) {
    selectedElements[index].el.style.outline = "";
    selectedElements.splice(index, 1);
  }

  /**
   * Briefly thicken a selected element's outline to acknowledge a click that
   * was a no-op because that element (an ancestor) is already selected.
   */
  function flashSelected(el) {
    el.style.outline = "4px solid #2563ff";
    setTimeout(function () {
      // Only revert if the element is still selected (not removed meanwhile).
      if (isSelected(el) !== -1) {
        el.style.outline = SELECTED_OUTLINE;
      }
    }, 300);
  }

  /**
   * Toggle an element into/out of the selection, applying nested de-dup rules:
   * - if it's already selected -> remove it (toggle off)
   * - if it's contained by an already-selected element -> ignore
   * - if it contains already-selected elements -> remove those, then add it
   * - otherwise -> add it
   */
  function toggleSelection(el) {
    const existing = isSelected(el);
    if (existing !== -1) {
      removeSelectionAt(existing);
      updateBadge();
      return;
    }

    // If an ancestor is already selected the content is already captured, so
    // don't add el; flash the ancestor so the click still gives feedback.
    for (const entry of selectedElements) {
      if (entry.el !== el && entry.el.contains(el)) {
        flashSelected(entry.el);
        return;
      }
    }

    // Remove any already-selected descendants; this element supersedes them.
    for (let i = selectedElements.length - 1; i >= 0; i--) {
      if (el.contains(selectedElements[i].el)) {
        removeSelectionAt(i);
      }
    }

    addSelection(el);
    updateBadge();
  }

  function handleElementClick(event) {
    if (!isExtensionActive) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const element = event.target.closest("*");
    if (!element) return;

    // Toggling changes the outline directly; drop hover bookkeeping so the
    // hover-out handler doesn't later clear a selected element's outline.
    if (hoveredElement === element) {
      hoveredElement = null;
    }

    toggleSelection(element);
  }

  /**
   * Create/update the floating counter badge. Removes it when nothing selected.
   */
  function updateBadge() {
    const count = selectedElements.length;

    if (count === 0) {
      removeBadge();
      return;
    }

    if (!badgeElement) {
      badgeElement = document.createElement("div");
      badgeElement.style.cssText =
        "position: fixed;" +
        "bottom: 20px;" +
        "right: 20px;" +
        "background: black;" +
        "color: white;" +
        "padding: 16px 24px;" +
        "border-radius: 8px;" +
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' +
        "font-size: 14px;" +
        "box-shadow: 0 4px 12px rgba(0,0,0,0.3);" +
        "z-index: 999999;";
      document.body.appendChild(badgeElement);
    }

    badgeElement.textContent =
      count + " selected · Enter to copy · Esc to cancel";
  }

  function removeBadge() {
    if (badgeElement) {
      badgeElement.remove();
      badgeElement = null;
    }
  }

  /**
   * Scrape all selected elements in click order, copy the joined markdown.
   */
  function finishSelection() {
    // Remove the badge before scraping so its text can never be captured into
    // the output (e.g. when a selected element contains document.body).
    removeBadge();

    const parts = selectedElements
      .map(function (entry) {
        try {
          return scrapeToMarkdown(entry.el);
        } catch (err) {
          console.error("Failed to scrape element: ", err);
          return "";
        }
      })
      .filter(Boolean);

    deactivateExtension();

    if (parts.length === 0) return;

    const markdown = parts.join("\n\n---\n\n");

    navigator.clipboard.writeText(markdown).then(
      function () {
        showToast("Markdown copied to clipboard!");
      },
      function (err) {
        console.error("Failed to copy content: ", err);
        showToast("Failed to copy to clipboard", true);
      }
    );
  }

  /**
   * True if the event target is a field the user might be typing into, so the
   * extension shouldn't steal its Enter/Escape keystrokes.
   */
  function isEditableTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function handleKeyDown(event) {
    if (!isExtensionActive) return;

    // Let focused inputs/editors keep their own Enter/Escape behavior.
    if (isEditableTarget(event.target)) return;

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      finishSelection();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      deactivateExtension();
    }
  }

  function handleElementHover(event) {
    if (!isExtensionActive) return;

    const element = event.target.closest("*");
    if (element && element !== hoveredElement) {
      // Restore the previous hovered element's outline, but never touch an
      // element that is part of the selection.
      if (hoveredElement && isSelected(hoveredElement) === -1) {
        hoveredElement.style.outline = "";
      }
      // Leave selected elements showing their persistent selected outline.
      if (isSelected(element) === -1) {
        element.style.outline = HOVER_OUTLINE;
      }
      hoveredElement = element;
    }
  }

  function handleElementHoverOut(event) {
    if (!isExtensionActive) return;

    const element = event.target.closest("*");
    if (element === hoveredElement) {
      if (isSelected(element) === -1) {
        element.style.outline = "";
      }
      hoveredElement = null;
    }
  }

  function deactivateExtension() {
    document.removeEventListener("click", handleElementClick, true);
    document.removeEventListener("mouseover", handleElementHover);
    document.removeEventListener("mouseout", handleElementHoverOut);
    document.removeEventListener("keydown", handleKeyDown, true);

    // Restore outlines for every selected element and clear the selection.
    for (let i = selectedElements.length - 1; i >= 0; i--) {
      removeSelectionAt(i);
    }

    if (hoveredElement) {
      hoveredElement.style.outline = "";
      hoveredElement = null;
    }

    removeBadge();

    isExtensionActive = false;

    // Clear the cross-injection cleanup handle only if it still points at this
    // session (a newer injection may have already replaced it).
    if (window.__webtextCleanup === deactivateExtension) {
      window.__webtextCleanup = null;
    }
  }

  function activateExtension() {
    document.addEventListener("click", handleElementClick, true);
    document.addEventListener("mouseover", handleElementHover);
    document.addEventListener("mouseout", handleElementHoverOut);
    document.addEventListener("keydown", handleKeyDown, true);

    // Expose this session's teardown so a later re-injection can end it first.
    window.__webtextCleanup = deactivateExtension;

    isExtensionActive = true;
  }

  activateExtension();
}
