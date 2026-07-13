(() => {
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  function inline(value) {
    return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function render(value = "") {
    const lines = String(value).replace(/\r\n?/g, "\n").split("\n"), output = [];
    let paragraph = [], list = [];
    const flushParagraph = () => { if (paragraph.length) output.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; };
    const flushList = () => { if (list.length) output.push(`<ul>${list.map((line) => `<li>${inline(line)}</li>`).join("")}</ul>`); list = []; };
    lines.forEach((line) => {
      if (/^###\s+/.test(line)) { flushParagraph(); flushList(); output.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`); return; }
      if (/^##\s+/.test(line)) { flushParagraph(); flushList(); output.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`); return; }
      if (/^-\s+/.test(line)) { flushParagraph(); list.push(line.replace(/^-\s+/, "")); return; }
      if (/^>\s?/.test(line)) { flushParagraph(); flushList(); output.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); return; }
      if (!line.trim()) { flushParagraph(); flushList(); return; }
      flushList(); paragraph.push(line);
    });
    flushParagraph(); flushList();
    return output.join("");
  }
  window.EBINA_ARTICLE_FORMAT = { render };
})();
