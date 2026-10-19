# LinkSeg model — attribution & license

`linkseg_7c.onnx` is an onnxruntime-web port of the pretrained **LinkSeg** 7-class music
structure / section-labeling model.

**Attribution (required by CC-BY 4.0):**

> M. Buisson, B. McFee, S. Essid — *Using Pairwise Link Prediction and Graph Attention
> Networks for Music Structure Analysis*, ISMIR 2024.

- Upstream project: https://github.com/morgan76/LinkSeg
- License basis: **Creative Commons Attribution 4.0 International (CC-BY 4.0)** —
  https://creativecommons.org/licenses/by/4.0/

The weights were ported (DGL graph ops rewritten as dense-tensor equivalents; mel front-end,
cdist, GroupNorm, EMA adaptive-pool, and batch-stat BatchNorm decomposed to ONNX-standard ops)
and validated byte-exact against the original PyTorch/DGL model. The port does not modify the
learned parameters. If you redistribute this model you must preserve this attribution.
