"""LoRA training for a brand/product image style (SD 1.5, fits a Kaggle T4).

Run on Kaggle (the adapter pushes this kernel):
    kaggle kernels push -p src/lib/tools/workers/kaggle-lora
Run locally on any GPU box:
    python train-lora.py --data /path/to/images --output ./lora-out

Data layout: a folder of images (.jpg/.png); each image may have a
sibling .txt caption file — when absent, --instance-prompt is used for
every image. Train on 20-100 images of ONE style (same product shots,
same lighting, same background family) — a mixed folder trains a
mixed style.

Output: a LoRA adapter dir (adapter_model.safetensors + config) that
plugs into any SD 1.5 pipeline with pipe.load_lora_weights(output).
The adapter is small (~20-70 MB at rank 16) and loads in seconds.

Why SD 1.5 and not SDXL: a Kaggle T4 has 16 GB VRAM. SDXL LoRA
training needs ~24 GB+ and will OOM; SD 1.5 trains comfortably at
512px with gradient checkpointing. Wan 5B video LoRA is a different
job — that goes to Modal (A100-40GB), never Kaggle.

NOT live-tested: no Kaggle account/token exists yet. The first
`kaggle kernels push` is the validation.
"""

import argparse
import math
import os
import random

import torch
from PIL import Image
from torch.utils.data import Dataset


class ImageCaptionDataset(Dataset):
    def __init__(self, data_dir, instance_prompt, resolution, tokenizer):
        self.items = []
        for name in sorted(os.listdir(data_dir)):
            if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            path = os.path.join(data_dir, name)
            txt_path = os.path.splitext(path)[0] + ".txt"
            caption = instance_prompt
            if os.path.exists(txt_path):
                with open(txt_path, encoding="utf-8") as f:
                    caption = f.read().strip() or instance_prompt
            self.items.append((path, caption))
        if not self.items:
            raise ValueError(f"no images found in {data_dir}")
        self.resolution = resolution
        self.tokenizer = tokenizer

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        path, caption = self.items[idx]
        img = Image.open(path).convert("RGB")
        img = img.resize((self.resolution, self.resolution), Image.LANCZOS)
        pixel = torch.tensor(list(img.getdata()), dtype=torch.float32)
        pixel = pixel.view(self.resolution, self.resolution, 3).permute(2, 0, 1) / 127.5 - 1.0
        ids = self.tokenizer(
            caption, padding="max_length", truncation=True,
            max_length=self.tokenizer.model_max_length, return_tensors="pt",
        ).input_ids[0]
        return {"pixel_values": pixel, "input_ids": ids}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="folder of training images")
    ap.add_argument("--base-model", default="runwayml/stable-diffusion-v1-5")
    ap.add_argument("--output", default="/kaggle/working/lora-out")
    ap.add_argument("--instance-prompt", default="a premium product photo, studio lighting")
    ap.add_argument("--resolution", type=int, default=512)
    ap.add_argument("--steps", type=int, default=1000)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    from diffusers import AutoencoderKL, DDPMScheduler, StableDiffusionPipeline, UNet2DConditionModel
    from diffusers.optimization import get_cosine_schedule_with_warmup
    from peft import LoraConfig, get_peft_model
    from transformers import CLIPTextModel, CLIPTokenizer

    device = "cuda"
    tokenizer = CLIPTokenizer.from_pretrained(args.base_model, subfolder="tokenizer")
    text_encoder = CLIPTextModel.from_pretrained(args.base_model, subfolder="text_encoder").to(device)
    vae = AutoencoderKL.from_pretrained(args.base_model, subfolder="vae").to(device)
    unet = UNet2DConditionModel.from_pretrained(args.base_model, subfolder="unet").to(device)
    noise_scheduler = DDPMScheduler.from_pretrained(args.base_model, subfolder="scheduler")
    for m in (text_encoder, vae):
        m.requires_grad_(False)
    unet.enable_gradient_checkpointing()

    lora_config = LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.0,
        target_modules=["to_q", "to_k", "to_v", "to_out.0"],
    )
    unet = get_peft_model(unet, lora_config)
    unet.print_trainable_parameters()

    ds = ImageCaptionDataset(args.data, args.instance_prompt, args.resolution, tokenizer)
    loader = torch.utils.data.DataLoader(ds, batch_size=args.batch, shuffle=True)
    optimizer = torch.optim.AdamW(unet.parameters(), lr=args.lr)
    total = math.ceil(args.steps / args.grad_accum)
    scheduler = get_cosine_schedule_with_warmup(optimizer, int(total * 0.1), total)

    step = 0
    done = False
    os.makedirs(args.output, exist_ok=True)
    while not done:
        for batch in loader:
            pixel = batch["pixel_values"].to(device)
            with torch.no_grad():
                latents = vae.encode(pixel).latent_dist.sample() * vae.config.scaling_factor
                enc = text_encoder(batch["input_ids"].to(device))[0]
            noise = torch.randn_like(latents)
            t = torch.randint(0, noise_scheduler.config.num_train_timesteps, (latents.shape[0],), device=device)
            noisy = noise_scheduler.add_noise(latents, noise, t)
            pred = unet(noisy, t, enc).sample
            loss = torch.nn.functional.mse_loss(pred.float(), noise.float()) / args.grad_accum
            loss.backward()
            if (step + 1) % args.grad_accum == 0:
                torch.nn.utils.clip_grad_norm_(unet.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad()
            step += 1
            if step % 100 == 0:
                print(f"step {step}/{args.steps} loss {loss.item() * args.grad_accum:.4f}", flush=True)
            if step % 250 == 0:
                unet.save_pretrained(os.path.join(args.output, f"checkpoint-{step}"))
            if step >= args.steps:
                done = True
                break
    unet.save_pretrained(args.output)
    print(f"saved LoRA adapter to {args.output}", flush=True)


if __name__ == "__main__":
    main()
