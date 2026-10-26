from pathlib import Path

import pypdfium2 as pdfium


GUIDE = Path(
    "/Users/petersargent/Library/CloudStorage/GoogleDrive-peter@imetpetersargent.com/"
    "My Drive/BrandGuides/EXP Brand Identity Guidelines_2.2016_EXBC.pdf"
)
ASSETS = Path(__file__).resolve().parents[1] / "src" / "assets"


def main():
    document = pdfium.PdfDocument(GUIDE)
    page = document[5]
    width, height = page.get_size()

    def extract(box):
        left, top, right, bottom = box
        return page.render(
            scale=2,
            crop=(left, height - bottom, width - right, top),
        ).to_pil()

    extract((680, 230, 1705, 450)).save(ASSETS / "exploring-wordmark-light.png")
    extract((680, 660, 1705, 880)).save(ASSETS / "exploring-wordmark-dark.png")
    compass = extract((1127, 278, 1251, 402))
    for size in (32, 180, 192):
        compass.resize((size, size)).save(ASSETS / f"exploring-favicon-{size}.png")


if __name__ == "__main__":
    main()
