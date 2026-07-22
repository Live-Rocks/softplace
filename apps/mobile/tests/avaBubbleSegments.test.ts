import assert from "node:assert/strict";
import test from "node:test";
import { splitAvaBubbleSegments } from "../src/utils/avaBubbleSegments";

test("keeps one sentence in one bubble", () => {
  assert.deepEqual(splitAvaBubbleSegments("今天有點累。"), ["今天有點累。"]);
});

test("splits two and three sentences into separate bubbles", () => {
  assert.deepEqual(splitAvaBubbleSegments("蛤，等一下。所以他還是這樣說喔。"), [
    "蛤，等一下。",
    "所以他還是這樣說喔。"
  ]);
  assert.deepEqual(splitAvaBubbleSegments("第一個句子。第二個句子！第三個句子？"), ["第一個句子。", "第二個句子！", "第三個句子？"]);
});

test("merges adjacent very short sentences", () => {
  assert.deepEqual(splitAvaBubbleSegments("嗯。也是。"), ["嗯。也是。"]);
});

test("caps longer replies at three ordered bubbles", () => {
  const result = splitAvaBubbleSegments("第一個完整句子。第二個完整句子。第三個完整句子。第四個完整句子。第五個完整句子。");
  assert.equal(result.length, 3);
  assert.equal(result.join("\n").replace(/\s/g, ""), "第一個完整句子。第二個完整句子。第三個完整句子。第四個完整句子。第五個完整句子。");
});

test("keeps a short opening reaction separate when capping bubbles", () => {
  assert.deepEqual(splitAvaBubbleSegments("蛤！第一個比較長的句子。第二個比較長的句子。第三個比較長的句子。第四個比較長的句子。"), [
    "蛤！",
    "第一個比較長的句子。\n第二個比較長的句子。",
    "第三個比較長的句子。\n第四個比較長的句子。"
  ]);
});

test("attaches a standalone parenthetical to the following sentence", () => {
  assert.deepEqual(splitAvaBubbleSegments("（先抱一下）\n\n你今天真的辛苦了。還好你有說出來。"), [
    "（先抱一下）\n你今天真的辛苦了。",
    "還好你有說出來。"
  ]);
});

test("preserves quoted punctuation without splitting inside the sentence", () => {
  assert.deepEqual(splitAvaBubbleSegments("她說「不要！」然後就走了。你一定很錯愕吧？"), [
    "她說「不要！」然後就走了。",
    "你一定很錯愕吧？"
  ]);
});

test("does not split English periods in versions, decimals, or URLs", () => {
  assert.deepEqual(splitAvaBubbleSegments("版本是 1.2.3，價格是 3.5，網址是 example.com。真的嗎？"), [
    "版本是 1.2.3，價格是 3.5，網址是 example.com。",
    "真的嗎？"
  ]);
});
