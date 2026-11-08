"""Export a sentence-embedding model (XLM-R family, mean pooling) to the layout transformers.js expects and quantize it
to 8 bit (int8 weights), like the Xenova/* models OHS loads with dtype 'q8'.

python semantic-export-onnx.py <hf repo or local dir> <output dir> [q8|fp32]

Mode q8 (default) writes the quantized graph. Mode fp32 writes the unquantized graph under the same file name, because OHS
loads dtype 'q8' = onnx/model_quantized.onnx; it gives the model's own quality at 3 to 4 times the size and about 2x the time.

Output: <out>/config.json, tokenizer files, onnx/model_quantized.onnx. The fp32 graph is written to a scratch directory
next to the output and deleted. Needs torch, transformers, onnx, onnxruntime.
"""
import os
import shutil
import sys

import torch
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.shape_inference import quant_pre_process
from transformers import AutoModel, AutoTokenizer

repo, out = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else "q8"
scratch = out + ".scratch"
os.makedirs(os.path.join(out, "onnx"), exist_ok=True)
os.makedirs(scratch, exist_ok=True)

tokenizer = AutoTokenizer.from_pretrained(repo)
# eager attention keeps the mask handling out of the graph (the SDPA path adds Where/IsNaN nodes and runs about 1.5x slower)
model = AutoModel.from_pretrained(repo, attn_implementation="eager").eval()
tokenizer.save_pretrained(out)
model.config.save_pretrained(out)

texts = ["giữ chân khách hàng", "mẹo cất giữ của cải đều đặn", "Hội An là phố cổ ở miền Trung", "kế hoạch marketing quý bốn"]
enc = tokenizer(texts, padding=True, return_tensors="np")


def pooled(h, mask):
    v = (h * mask[..., None]).sum(1) / mask.sum(1, keepdims=True)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


# Reference embeddings from the untouched torch model (torch.onnx.export changes the module, so take them first).
with torch.no_grad():
    ref = pooled(model(**tokenizer(texts, padding=True, return_tensors="pt")).last_hidden_state.numpy(), enc["attention_mask"])


class Wrapper(torch.nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, input_ids, attention_mask):
        return self.inner(input_ids=input_ids, attention_mask=attention_mask, use_cache=False).last_hidden_state


sample = tokenizer(["xin chào các bạn", "một câu dài hơn để có chiều dài khác nhau"], padding=True, return_tensors="pt")
fp32 = os.path.join(scratch, "model.onnx")
torch.onnx.export(
    Wrapper(model),
    (sample["input_ids"], sample["attention_mask"]),
    fp32,
    input_names=["input_ids", "attention_mask"],
    output_names=["last_hidden_state"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "sequence"},
        "attention_mask": {0: "batch", 1: "sequence"},
        "last_hidden_state": {0: "batch", 1: "sequence"},
    },
    opset_version=17,
    dynamo=False,
)
quantized = os.path.join(out, "onnx", "model_quantized.onnx")
if mode == "fp32":
    shutil.copy(fp32, quantized)
else:
    pre = os.path.join(scratch, "pre.onnx")
    quant_pre_process(fp32, pre, skip_symbolic_shape=True)
    # int8 weights with uint8 activations take ORT's faster MatMulInteger path (uint8 weights were about 2x slower)
    quantize_dynamic(pre, quantized, weight_type=QuantType.QInt8)

session = ort.InferenceSession(quantized, providers=["CPUExecutionProvider"])
hidden = session.run(None, {"input_ids": enc["input_ids"], "attention_mask": enc["attention_mask"]})[0]
cos = (pooled(hidden, enc["attention_mask"]) * ref).sum(1)
print(f"cosine({mode}, torch fp32) per sentence:", [round(float(c), 4) for c in cos])
shutil.rmtree(scratch)
print("wrote", out)
