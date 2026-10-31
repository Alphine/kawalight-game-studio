"""Mock provider (FR-006): deterministic placeholder PNGs, zero cost.

Used for tests, offline development, and UI previews. Real provider adapters
(DALL-E, Stable Diffusion, ...) plug into the same registry later.
"""

from __future__ import annotations

import hashlib
import random

from PIL import Image, ImageDraw

from .base import GeneratedImage, ImageProvider, ProviderError


def _palette(seed: int) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    digest = hashlib.sha256(str(seed).encode()).digest()
    return (
        (digest[0], digest[1], digest[2]),
        (digest[3], digest[4], digest[5]),
    )


def render_placeholder(width: int, height: int, seed: int) -> bytes:
    import io

    bg, fg = _palette(seed)
    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)
    rng = random.Random(seed)
    for _ in range(max(4, width // 8)):
        x0, y0 = rng.randrange(width), rng.randrange(height)
        r = rng.randrange(2, max(3, min(width, height) // 4))
        draw.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=fg)
    draw.rectangle([0, 0, width - 1, height - 1], outline=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class MockProvider(ImageProvider):
    id = "mock"
    display_name = "Mock (offline placeholders)"
    model = "mock-1"

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def estimate_cents(self, n_images: int) -> int | None:
        return 0

    def generate(
        self, prompt: str, *, style: str, width: int, height: int,
        seed: int | None = None, n_images: int = 1,
    ) -> list[GeneratedImage]:
        if not prompt.strip():
            raise ProviderError("prompt must not be empty")
        if n_images < 1 or n_images > 16:
            raise ProviderError("n_images must be 1..16")
        for name, side in (("width", width), ("height", height)):
            if (isinstance(side, bool) or not isinstance(side, int)
                    or side < 1 or side > 4096):
                raise ProviderError(
                    f"{name} must be an integer 1..4096")
        self.calls.append({"prompt": prompt, "style": style, "n_images": n_images})
        out = []
        for i in range(n_images):
            s = (seed or 0) + i
            try:
                png = render_placeholder(width, height, s)
            except Exception as exc:  # noqa: BLE001 - mapped below
                raise ProviderError(
                    f"mock render failed: {exc}") from None
            out.append(GeneratedImage(
                png_bytes=png,
                width=width, height=height, model=self.model, seed=seed,
            ))
        return out


class FailingProvider(ImageProvider):
    """Simulates a provider outage. Used to prove NFR-003 handling."""

    id = "failing"
    display_name = "Failing (test outage)"
    model = "none"

    def estimate_cents(self, n_images: int) -> int | None:
        return None

    def generate(self, prompt: str, **kwargs) -> list[GeneratedImage]:
        raise ProviderError("simulated provider outage")
