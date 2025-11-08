// content_script.js
// Chrome extension content script
// Realtime parsing menggunakan MutationObserver + debounce (500ms)

(() => {
  'use strict';

  // Alias map: tambahkan/ubah sesuai kebutuhan
  const aliasMap = {
    "pcd": "cdn.fourvo.id",    // alias pcd -> cdn.fourvo.id
    "yt": "i.ytimg.com",
    "gh": "raw.githubusercontent.com",
    "mc": "textures.minecraft.net"
  };

  // Regex utama untuk mendeteksi [image=...]
  const IMAGE_TAG_REGEX = /\[image=(.*?)\]/g;

  // Normalizer (mendukung:
  //  - hs://pcd (domain)/(path)
  //  - hs://pcd/(path)
  //  - h:// / hs://
  //  - .cv -> .com, .dic -> .id, .mcd -> .me
  function normalizeURL(url) {
    if (!url) return url;
    url = url.trim();

    // complex: hs://pcd (domain)/(path)  OR  h://pcd (domain)/(path)
    let complexMatch = url.match(/^(hs|h):\/\/(\w+)\s*\((.*?)\)\/\((.*?)\)$/);
    if (complexMatch) {
      const scheme = complexMatch[1] === "hs" ? "https" : "http";
      const domain = complexMatch[3];
      const path = complexMatch[4];
      return `${scheme}://${domain}/${path}`;
    }

    // alias short: hs://pcd/(path) OR h://pcd/(path)
    let aliasMatch = url.match(/^(hs|h):\/\/(\w+)\/\((.*?)\)$/);
    if (aliasMatch) {
      const scheme = aliasMatch[1] === "hs" ? "https" : "http";
      const alias = aliasMatch[2];
      const path = aliasMatch[3];
      if (aliasMap[alias]) {
        return `${scheme}://${aliasMap[alias]}/${path}`;
      }
    }

    // fallback: simple replacements
    url = url
      .replace(/^h:\/\//, "http://")
      .replace(/^hs:\/\//, "https://")
      .replace(/\.cv\b/g, ".com")
      .replace(/\.dic\b/g, ".id")
      .replace(/\.mcd\b/g, ".me");

    return url;
  }

  // Replace text-node occurrences of [image=...] inside a comment element
  function processCommentElement(el) {
    // Avoid double-processing: mark the element after processed
    // If comment text changes later, it's okay to re-run because we check text nodes
    if (!el || el.dataset.imageParserProcessed === "1") {
      // we'll still scan child text nodes in case of edits; but to save work, skip if already flagged
      // we still want minor re-run when new nodes are added via MutationObserver
    }

    // Walk child nodes and replace text nodes that contain [image=...]
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(textNode => {
      const text = textNode.nodeValue;
      if (!text) return;
      if (!IMAGE_TAG_REGEX.test(text)) return;
      // Reset lastIndex in case global regex was used earlier
      IMAGE_TAG_REGEX.lastIndex = 0;

      // Build a fragment with text and <img> elements
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      while ((match = IMAGE_TAG_REGEX.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const rawUrl = match[1].trim();
        const normalized = normalizeURL(rawUrl);

        // Create image element safely
        try {
          const img = document.createElement('img');
          img.src = normalized;
          img.alt = '';
          img.className = 'yt-image-parser-img';
          img.style.maxWidth = '220px';
          img.style.maxHeight = '220px';
          img.style.borderRadius = '8px';
          img.style.margin = '6px 0';
          img.style.display = 'block';
          // optional: lazy loading attribute
          img.loading = 'lazy';
          frag.appendChild(img);
        } catch (e) {
          // fallback: just put raw text if creation failed
          frag.appendChild(document.createTextNode(match[0]));
        }

        lastIndex = IMAGE_TAG_REGEX.lastIndex;
      }

      // trailing text
      const trailing = text.slice(lastIndex);
      if (trailing) frag.appendChild(document.createTextNode(trailing));

      // Replace the original text node with fragment
      textNode.parentNode.replaceChild(frag, textNode);
    });

    // mark processed to reduce repeated full scanning (we still allow future processing when new nodes added)
    el.dataset.imageParserProcessed = "1";
  }

  // Process all visible comment text containers currently on page
  function processAllComments() {
    // YouTube comment texts are inside #content-text (works in many layouts)
    const commentEls = document.querySelectorAll('#content-text');
    if (!commentEls || commentEls.length === 0) return;
    commentEls.forEach(el => {
      processCommentElement(el);
    });
  }

  // Debounce helper (500ms)
  function debounce(fn, wait) {
    let t = null;
    return function(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        fn.apply(this, args);
        t = null;
      }, wait);
    };
  }

  const debouncedProcess = debounce(processAllComments, 500);

  // Initial parse after page load
  window.addEventListener('yt-navigate-finish', () => {
    // some SPA navigation events, but not always available; safe to call anyway
    setTimeout(processAllComments, 700);
  });

  // Fallback initial run
  setTimeout(processAllComments, 800);

  // Observe DOM changes for realtime comments / dynamic loads
  const observer = new MutationObserver(mutations => {
    // If many mutations, we still debounce to 500ms
    let relevant = false;
    for (const m of mutations) {
      // new nodes added that might include comments
      if (m.addedNodes && m.addedNodes.length) {
        relevant = true;
        break;
      }
      // characterData changes (text edits) also relevant
      if (m.type === 'characterData') {
        relevant = true;
        break;
      }
    }
    if (relevant) debouncedProcess();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // optional: re-run periodically as a safety net (low-frequency)
  setInterval(processAllComments, 10_000);

})();
