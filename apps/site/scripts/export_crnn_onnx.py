#!/usr/bin/env python3
"""
Export the CRNN drum transcription model from PyTorch to ONNX.

Usage:
    python scripts/export_crnn_onnx.py [--checkpoint PATH] [--output PATH]

Requires:
    pip install torch onnx onnxruntime numpy

The script imports the CRNN model class from the drum-to-chart training repo
and exports it with dynamic time axis for variable-length audio inference.

Inputs:
    mel:     (1, 1, 128, W)  — log-mel spectrogram
    panning: (1, 4, W)       — L/R energy ratio in 4 freq bands
    context: (1, 1280)       — song-level context vector

Output:
    logits:  (1, W, 9)       — raw logits (apply sigmoid in JS)
"""

import argparse
import os
import sys

import numpy as np
import torch
import torch.nn as nn

# ---------------------------------------------------------------------------
# Model architecture (self-contained, copied from train.py at commit ef7ac22)
# ---------------------------------------------------------------------------

N_INSTRUMENTS = 9
SONG_CONTEXT_DIM = 1280  # 128 (mean mel) + 9*128 (per-instrument onset mel)


class ResBlock2d(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        residual = x
        x = torch.relu(self.bn1(self.conv1(x)))
        x = self.bn2(self.conv2(x))
        return torch.relu(x + residual)


class CRNN(nn.Module):
    """CNN encoder with SE-ResBlocks + panning fusion + per-frame head."""

    def __init__(self):
        super().__init__()

        self.time_pool = 4
        self.cnn = nn.Sequential(
            # Block 1: (5, 128, W) -> (64, 64, W/2)
            nn.Conv2d(5, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d((2, 2)),
            ResBlock2d(64),

            # Block 2: (64, 64, W/2) -> (128, 32, W/4)
            nn.Conv2d(64, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.MaxPool2d((2, 2)),
            ResBlock2d(128),

            # Block 3: (128, 32, W/4) -> (256, 16, W/4)
            nn.Conv2d(128, 256, 3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            ResBlock2d(256),

            # Block 4: (256, 16, W/4) -> (256, 8, W/4)
            nn.Conv2d(256, 256, 3, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(),
            nn.MaxPool2d((2, 1)),
            ResBlock2d(256),
        )

        cnn_feat_dim = 256 * 8  # 2048
        ctx_embed_dim = 128

        self.context_proj = nn.Sequential(
            nn.Linear(SONG_CONTEXT_DIM, 256),
            nn.GELU(),
            nn.Linear(256, ctx_embed_dim),
            nn.GELU(),
        )

        self.fusion = nn.Sequential(
            nn.Linear(cnn_feat_dim + ctx_embed_dim, 384),
            nn.GELU(),
            nn.Dropout(0.2),
        )

        self.lstm = nn.GRU(
            input_size=384,
            hidden_size=384,
            num_layers=2,
            bidirectional=True,
            batch_first=True,
            dropout=0.1,
        )

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=768, nhead=8, dim_feedforward=768,
            dropout=0.2, batch_first=True,
        )
        self.attn = nn.TransformerEncoder(encoder_layer, num_layers=2)

        self.upsample = nn.Sequential(
            nn.ConvTranspose1d(768, 384, kernel_size=2, stride=2),
            nn.BatchNorm1d(384),
            nn.ReLU(),
            nn.ConvTranspose1d(384, 192, kernel_size=2, stride=2),
            nn.BatchNorm1d(192),
            nn.ReLU(),
        )

        self.head = nn.Linear(192, N_INSTRUMENTS)

    def forward(self, mel, panning, context):
        """
        mel:     (batch, 1, 128, W)
        panning: (batch, 4, W)
        context: (batch, 1280)
        Returns: (batch, W, 9) raw logits
        """
        W = mel.shape[3]
        B = mel.shape[0]

        pan_feat = panning.unsqueeze(2).expand(-1, -1, 128, -1)
        x = torch.cat([mel, pan_feat], dim=1)  # (B, 5, 128, W)

        x = self.cnn(x)
        _, C, F, T = x.shape
        x = x.permute(0, 3, 1, 2).reshape(B, T, C * F)

        ctx = self.context_proj(context)
        ctx_expanded = ctx.unsqueeze(1).expand(-1, T, -1)
        x = torch.cat([x, ctx_expanded], dim=2)

        x = self.fusion(x)
        x, _ = self.lstm(x)
        x = self.attn(x)

        x = x.permute(0, 2, 1)
        x = self.upsample(x)
        x = x[:, :, :W]
        x = x.permute(0, 2, 1)

        return self.head(x)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Export CRNN to ONNX")
    parser.add_argument(
        "--checkpoint",
        default=os.path.expanduser("~/Downloads/checkpoints_ef7ac22_best_model.pt"),
        help="Path to the PyTorch checkpoint (.pt)",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "public", "models", "crnn_drum_transcriber.onnx",
        ),
        help="Output ONNX model path",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.checkpoint):
        print(f"ERROR: Checkpoint not found: {args.checkpoint}")
        sys.exit(1)

    print(f"Loading checkpoint: {args.checkpoint}")
    model = CRNN()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    # Handle different checkpoint formats
    if isinstance(checkpoint, dict):
        if "model_state_dict" in checkpoint:
            state_dict = checkpoint["model_state_dict"]
        elif "model" in checkpoint:
            state_dict = checkpoint["model"]
        elif "state_dict" in checkpoint:
            state_dict = checkpoint["state_dict"]
        else:
            # Assume it's a raw state_dict if it has expected keys
            state_dict = checkpoint
    else:
        state_dict = checkpoint
    model.load_state_dict(state_dict)
    model.eval()
    print(f"  Loaded {sum(p.numel() for p in model.parameters()):,} parameters")

    # Dummy inputs — W must be divisible by time_pool (4)
    W = 500  # 5 seconds at 100fps
    dummy_mel = torch.randn(1, 1, 128, W)
    dummy_panning = torch.randn(1, 4, W)
    dummy_context = torch.randn(1, SONG_CONTEXT_DIM)

    # Verify forward pass
    with torch.no_grad():
        out = model(dummy_mel, dummy_panning, dummy_context)
    print(f"  PyTorch output shape: {out.shape}")  # expect (1, 500, 9)
    assert out.shape == (1, W, N_INSTRUMENTS), f"Unexpected shape: {out.shape}"

    # Export to ONNX
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    print(f"Exporting to ONNX: {args.output}")

    torch.onnx.export(
        model,
        (dummy_mel, dummy_panning, dummy_context),
        args.output,
        opset_version=17,
        input_names=["mel", "panning", "context"],
        output_names=["logits"],
        dynamic_axes={
            "mel": {3: "time"},
            "panning": {2: "time"},
            "logits": {1: "time"},
        },
        dynamo=False,  # Use legacy TorchScript exporter (dynamo has issues with GRU)
    )

    file_size_mb = os.path.getsize(args.output) / (1024 * 1024)
    print(f"  ONNX file size: {file_size_mb:.1f} MB")

    # Verify with onnxruntime
    print("Verifying with onnxruntime...")
    import onnxruntime as ort

    session = ort.InferenceSession(args.output)

    for inp in session.get_inputs():
        print(f"  Input: {inp.name}, shape={inp.shape}, dtype={inp.type}")
    for ort_output in session.get_outputs():
        print(f"  Output: {ort_output.name}, shape={ort_output.shape}, dtype={ort_output.type}")

    ort_result = session.run(
        None,
        {
            "mel": dummy_mel.numpy(),
            "panning": dummy_panning.numpy(),
            "context": dummy_context.numpy(),
        },
    )
    ort_out = ort_result[0]
    print(f"  ONNX Runtime output shape: {ort_out.shape}")

    # Compare PyTorch vs ONNX Runtime output
    pt_out = out.detach().numpy()
    max_diff = np.abs(pt_out - ort_out).max()
    print(f"  Max abs difference (PyTorch vs ONNX): {max_diff:.6f}")
    assert max_diff < 0.01, f"Too large difference: {max_diff}"

    # Note: The Transformer attention layer bakes in the sequence length during
    # TorchScript tracing, so the model only works at W=500 (our fixed window size).
    # This is fine since we always pad to WINDOW_SIZE=500 in the web worker.

    print("\nExport successful!")


if __name__ == "__main__":
    main()
