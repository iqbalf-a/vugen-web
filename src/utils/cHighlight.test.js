import { describe, expect, it } from "vitest";

import { highlightC } from "./cHighlight.js";

describe("highlightC", () => {
  it("mewarnai pemanggilan fungsi, string, konstanta, dan angka", () => {
    const html = highlightC('web_url("home", "URL=http://x/", LAST); // 1');
    expect(html).toContain('<span class="tok-call">web_url</span>');
    expect(html).toContain('<span class="tok-string">&quot;home&quot;</span>');
    expect(html).toContain('<span class="tok-constant">LAST</span>');
    expect(html).toContain('<span class="tok-comment">// 1</span>');
  });

  it("keyword, angka, dan direktif preprocessor", () => {
    const html = highlightC("#include \"x.h\"\nint a = 42;\nreturn 0;");
    expect(html).toContain('<span class="tok-keyword">#include</span>');
    expect(html).toContain('<span class="tok-keyword">int</span>');
    expect(html).toContain('<span class="tok-number">42</span>');
    expect(html).toContain('<span class="tok-keyword">return</span>');
  });

  it("meng-escape HTML dan tidak mewarnai isi string/komentar", () => {
    const html = highlightC('a("<b>if</b>"); /* int x */ b < c');
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;if&lt;/b&gt;");
    expect(html).not.toContain('tok-keyword">if');
    expect(html).toContain("b &lt; c");
  });

  it("input kosong atau bukan string aman", () => {
    expect(highlightC("")).toBe("");
    expect(highlightC(undefined)).toBe("");
  });
});
