// Synthetic, local-only fixtures. The smoke page never reads a music library.
export const fixtures = {
  multilingual: '[00:01.000]te su to no ka shi\n[00:01.000]テストの歌詞\n[00:01.000]这是测试歌词\n[00:06.000]Hello sample\n[00:06.000]英文夹句的翻译\n[00:12.000]只有一行的正文',
  lrc: `[offset:100]\n[00:01.000]第一行普通歌词\n[tr][00:01.000]A translated line\n[00:05.000]第二行用于检查行距\n[00:10.000]最后一句保留到曲尾`,
  eslrc: `[00:01.000]逐[00:02.000]字[00:03.000]歌[00:04.000]词[00:05.000]\n[00:06.000]真实[00:07.000]时间[00:08.000]间隙[00:10.000]\n[00:11.000]下一[00:13.000]句[00:15.000]`,
  ttml: `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
    <head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head>
    <body dur="20s"><div>
      <p begin="1s" end="5s" ttm:agent="v1" itunes:key="L1"><span begin="1s" end="2s">原生</span><span begin="3s" end="5s">逐字歌词</span><span ttm:role="x-translation" xml:lang="zh-CN">翻译保持在原生位置</span><span ttm:role="x-roman">yuan sheng zhu zi ge ci</span></p>
      <p begin="6s" end="10s" ttm:agent="v2" itunes:key="L2"><span begin="6s" end="8s">对唱</span><span begin="8s" end="10s">靠右显示</span><span ttm:role="x-bg" begin="7s" end="9s"><span begin="7s" end="9s">背景人声</span></span></p>
      <p begin="12s" end="16s" ttm:agent="v1" itunes:key="L3"><span begin="12s" end="14s">切换</span><span begin="14s" end="16s">字号和位置</span></p>
      <p begin="17s" end="19s" ttm:agent="v1" itunes:key="L4"><span begin="17s" end="19s">播放结束</span></p>
    </div></body></tt>`,
};
export type FixtureName = keyof typeof fixtures;
let activeFixture: FixtureName = 'ttml';
export const selectFixture = (name: FixtureName) => { activeFixture = name; };
export const readFixture = () => ({ rawLyrics: fixtures[activeFixture], sourceFormat: activeFixture === 'multilingual' ? 'lrc' : activeFixture, sourcePath: `fixture.${activeFixture}` });
