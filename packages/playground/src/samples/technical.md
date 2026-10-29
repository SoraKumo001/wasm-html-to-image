---
title: 数式とコードの技術メモ
author: A. Author
template: paper
---

# 数式とコードの技術メモ

このメモは、数式（`$...$` と `$$...$$`）とコードのハイライトを試すためのものです。金額の $5 や $10 は数式になりません。

## 二次方程式

$ax^2 + bx + c = 0$ の解は、判別式 $D = b^2 - 4ac$ を使って次のように書けます。

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

## 積分と総和

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}, \qquad \sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## 行列

$$
A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}, \qquad \det A = ad - bc
$$

## コード

```ts
export function mean(values: number[]): number {
  // 平均を求める
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

```bash
npx wasm-html-to-image memo.md -o memo.pdf --template paper
```

## 表

| 手法 | 計算量 | 備考 |
|---|---|---|
| 二分探索 | $O(\log n)$ | 整列済みが前提 |
| 線形探索 | $O(n)$ | 前提なし |
